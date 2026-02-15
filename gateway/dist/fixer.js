/**
 * Protocol Fixer Layer.
 *
 * Makes MCP "just work" by addressing the most common production pain points:
 * 1. Auto-restart crashed stdio server processes (with exponential backoff)
 * 2. Normalize inconsistent error responses into clear JSON-RPC errors
 * 3. Validate tool schemas on first tools/list and log warnings for issues
 */
/* ------------------------------------------------------------------ */
/*  Auto-restart                                                       */
/* ------------------------------------------------------------------ */
const MAX_RESTART_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 1000; // 1s, 2s, 4s, 8s, 16s
/** Track restart attempts per upstream */
const restartAttempts = new Map();
/**
 * Attempt to restart a failed upstream. Uses exponential backoff.
 * Returns true if restart succeeded.
 */
export async function tryRestart(manager, config) {
    const attempts = restartAttempts.get(config.name) ?? 0;
    if (attempts >= MAX_RESTART_ATTEMPTS) {
        console.error(`  [fixer] ${config.name}: max restart attempts (${MAX_RESTART_ATTEMPTS}) reached. Giving up.`);
        return false;
    }
    const delay = BASE_BACKOFF_MS * Math.pow(2, attempts);
    console.log(`  [fixer] ${config.name}: restarting in ${delay}ms (attempt ${attempts + 1}/${MAX_RESTART_ATTEMPTS})...`);
    await sleep(delay);
    // Disconnect the old client first
    await manager.disconnect(config.name);
    const ok = await manager.connect(config);
    if (ok) {
        restartAttempts.set(config.name, 0); // reset on success
        console.log(`  [fixer] ${config.name}: restart successful`);
        return true;
    }
    restartAttempts.set(config.name, attempts + 1);
    return false;
}
/**
 * Reset restart counter for a server (e.g. after a period of healthy operation).
 */
export function resetRestartCount(name) {
    restartAttempts.delete(name);
}
/* ------------------------------------------------------------------ */
/*  Error Normalization                                                */
/* ------------------------------------------------------------------ */
/**
 * Wrap an upstream call with error normalization.
 * Catches common failure patterns and returns clear, actionable errors.
 */
export async function withErrorNormalization(serverName, operation, fn) {
    try {
        return await fn();
    }
    catch (err) {
        throw new NormalizedError(serverName, operation, err);
    }
}
export class NormalizedError extends Error {
    serverName;
    operation;
    originalError;
    constructor(serverName, operation, originalError) {
        const raw = originalError instanceof Error
            ? originalError.message
            : String(originalError);
        const friendly = normalizeMcpError(serverName, operation, raw);
        super(friendly);
        this.name = "NormalizedError";
        this.serverName = serverName;
        this.operation = operation;
        this.originalError = originalError;
    }
}
/**
 * Map common cryptic MCP errors to actionable messages.
 */
function normalizeMcpError(server, operation, raw) {
    const lower = raw.toLowerCase();
    // Process spawn failures
    if (lower.includes("enoent") || lower.includes("spawn")) {
        const cmdHint = extractCommand(raw);
        return (`Server "${server}" failed to start: command not found${cmdHint ? ` (${cmdHint})` : ""}. ` +
            `Check that the command is installed and in your PATH.`);
    }
    // npx / uvx not found
    if (lower.includes("npx") && lower.includes("not found")) {
        return (`Server "${server}": npx is not installed. ` +
            `Install Node.js (https://nodejs.org) to get npx.`);
    }
    if (lower.includes("uvx") && lower.includes("not found")) {
        return (`Server "${server}": uvx is not installed. ` +
            `Run "pip install uv" or see https://docs.astral.sh/uv/.`);
    }
    // Connection reset / broken pipe (server crashed)
    if (lower.includes("broken pipe") ||
        lower.includes("epipe") ||
        lower.includes("econnreset") ||
        lower.includes("channel closed") ||
        lower.includes("process exited")) {
        return (`Server "${server}" crashed during ${operation}. ` +
            `The gateway will attempt to restart it automatically.`);
    }
    // Timeout
    if (lower.includes("timeout") || lower.includes("etimedout")) {
        return (`Server "${server}" timed out during ${operation}. ` +
            `The server may be overloaded or unresponsive.`);
    }
    // JSON parse errors
    if (lower.includes("json") && (lower.includes("parse") || lower.includes("unexpected"))) {
        return (`Server "${server}" returned invalid JSON during ${operation}. ` +
            `This usually means the server printed non-JSON output to stdout.`);
    }
    // Fallback: include server name and operation for context
    return `Server "${server}" error during ${operation}: ${raw}`;
}
function extractCommand(msg) {
    // Try to extract the command name from ENOENT messages
    const match = msg.match(/spawn\s+(\S+)/i) ?? msg.match(/ENOENT.*?['"]?(\S+?)['"]?\s/i);
    return match ? match[1] : null;
}
/**
 * Validate tool schemas from a server. Returns a list of issues found.
 * Does not reject tools — just logs warnings so developers can fix their servers.
 */
export function validateToolSchemas(serverName, tools) {
    const issues = [];
    for (const tool of tools) {
        // Missing or empty name
        if (!tool.name || tool.name.trim() === "") {
            issues.push({
                server: serverName,
                tool: "(unnamed)",
                issue: "Tool has no name",
                severity: "error",
            });
            continue;
        }
        // Missing description
        if (!tool.description || tool.description.trim() === "") {
            issues.push({
                server: serverName,
                tool: tool.name,
                issue: "Missing description — LLMs will struggle to select this tool correctly",
                severity: "warn",
            });
        }
        // Very short description (likely unhelpful)
        if (tool.description &&
            tool.description.trim().length > 0 &&
            tool.description.trim().length < 10) {
            issues.push({
                server: serverName,
                tool: tool.name,
                issue: `Description is very short (${tool.description.trim().length} chars): "${tool.description.trim()}"`,
                severity: "warn",
            });
        }
        // Missing inputSchema
        if (!tool.inputSchema) {
            issues.push({
                server: serverName,
                tool: tool.name,
                issue: "Missing inputSchema — tool parameters won't be validated",
                severity: "warn",
            });
            continue;
        }
        // inputSchema exists but missing "type"
        if (tool.inputSchema && !tool.inputSchema.type) {
            issues.push({
                server: serverName,
                tool: tool.name,
                issue: 'inputSchema is missing "type" field (should be "object")',
                severity: "warn",
            });
        }
        // Check individual properties for missing descriptions
        const props = tool.inputSchema?.properties;
        if (props) {
            for (const [paramName, paramSchema] of Object.entries(props)) {
                if (!paramSchema.description) {
                    issues.push({
                        server: serverName,
                        tool: tool.name,
                        issue: `Parameter "${paramName}" has no description`,
                        severity: "warn",
                    });
                }
            }
        }
    }
    return issues;
}
/**
 * Log schema validation issues in a human-friendly format.
 */
export function logSchemaIssues(issues) {
    if (issues.length === 0)
        return;
    console.log(`\n  [fixer] Schema validation found ${issues.length} issue(s):`);
    for (const issue of issues) {
        const icon = issue.severity === "error" ? "✗" : "⚠";
        console.log(`    ${icon} ${issue.server}/${issue.tool}: ${issue.issue}`);
    }
    console.log("");
}
/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
