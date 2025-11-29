# MCP Integration Manager: Simplifying MCP Setup for Coding Agents

## Product Vision
A tool that makes it trivially easy to discover, install, and manage MCP servers across all coding agents (Cursor, Windsurf, Cline, VS Code, etc.) - eliminating configuration headaches and fragmentation.

## Core Pain Points Identified

Based on research of developer experiences with MCP in 2025, here are the critical pain points:

### 1. **Configuration Fragmentation**
- **Cursor**: Uses `~/.cursor/mcp.json` or `.cursor/mcp.json`
- **Windsurf**: Uses `~/.codeium/windsurf/mcp_config.json`
- **Codex**: Uses `~/.codex/config.toml`
- **Claude Desktop**: Uses different config format
- **Problem**: Developers must learn different config formats and locations for each tool

### 2. **Poor Error Messages & Debugging**
- "MCP server won't load" with obscure error messages
- Agents fail to find global mcp.json files
- Dependency/virtual environment issues with no clear guidance
- No validation before runtime

### 3. **Dependency Hell**
- Must have `npx` (Node.js) installed for JS-based servers
- Must have `uvx` (uv/Python) installed for Python-based servers
- No clear guidance on which dependencies are needed
- Runtime failures when dependencies missing

### 4. **Discovery & Selection Chaos**
- 10,000+ MCP servers across multiple registries ([MCP.so](https://mcp.so/), [GitHub Registry](https://github.blog/ai-and-ml/github-copilot/meet-the-github-mcp-registry-the-fastest-way-to-discover-mcp-servers/), [MCPdb](https://mcpdb.org/), [Awesome MCP](https://mcpservers.org/))
- No unified way to browse and install
- Hard to know which servers work with which agents
- No ratings/reviews in most registries

### 5. **Setup Time & Friction**
- Manual TOML/JSON editing is error-prone
- [Cursor UI bugs](https://github.com/cursor/cursor/issues/2944): "+Add new global MCP server" doesn't work, shows file editor instead
- Slow iteration: 40+ minutes and 50+ tool calls for simple setups
- No automated testing of configuration

### 6. **Security Blindspots**
- [Missing security controls in Windsurf](https://embracethered.com/blog/posts/2025/windsurf-dangers-lack-of-security-controls-for-mcp-server-tool-invocation/) for MCP tool invocation
- Automatic tool execution without approval
- No clear visibility into what permissions MCP servers need

---

## Proposed Solution: "MCP Hub" CLI Tool

A universal CLI tool that abstracts away the complexity of MCP management across all coding agents.

### Core Value Proposition

**Before (Current State):**
```bash
# User wants to add GitHub MCP server to Cursor
1. Google "how to add MCP server to Cursor"
2. Find ~/.cursor/mcp.json location
3. Manually edit JSON with correct syntax
4. Hope npx is installed
5. Restart Cursor
6. Debug cryptic errors
⏱️ Time: 30-60 minutes
```

**After (With MCP Hub):**
```bash
$ mcphub add github --agent cursor
✓ Detected Cursor installation
✓ Verified npx is installed
✓ Downloaded GitHub MCP server config
✓ Validated configuration
✓ Added to ~/.cursor/mcp.json
✓ Ready to use!
⏱️ Time: 30 seconds
```

---

## Key Features

### 1. Universal Agent Support
```bash
# Works across all major coding agents
mcphub add <server> --agent cursor
mcphub add <server> --agent windsurf
mcphub add <server> --agent cline
mcphub add <server> --agent vscode
mcphub add <server> --agent codex
mcphub add <server> --agent all  # Add to all installed agents
```

### 2. Unified Discovery & Search
```bash
# Search across all MCP registries at once
mcphub search github
mcphub search "database" --category data
mcphub browse --popular
mcphub info eslint  # Show details, reviews, compatibility
```

Integrates with:
- [GitHub MCP Registry](https://github.blog/ai-and-ml/github-copilot/meet-the-github-mcp-registry-the-fastest-way-to-discover-mcp-servers/)
- [MCP.so](https://mcp.so/) (17,000+ servers)
- [MCPdb](https://mcpdb.org/) (10,000+ servers)
- [Awesome MCP Servers](https://mcpservers.org/)
- [Cline MCP Marketplace](https://github.com/cline/mcp-marketplace)

### 3. Automatic Dependency Management
```bash
# Automatically checks and installs prerequisites
$ mcphub add postgres
⚠️  uvx not found (required for Python-based servers)
? Install uv now? (Y/n) Y
✓ Installing uv...
✓ uvx is now available
✓ Adding postgres MCP server...
```

Handles:
- [npx/uvx detection and installation](https://dev.to/leomarsh/mcp-server-executables-explained-npx-uvx-docker-and-beyond-1i1n)
- Node.js/Python version compatibility
- Docker-based MCP servers

### 4. Configuration Validation
```bash
# Test configuration before agent restart
$ mcphub validate
✓ Cursor config: Valid (3 servers)
✓ Windsurf config: Valid (2 servers)
⚠️ Codex config: Syntax error in TOML line 12
✗ GitHub server: npx command failed (Node.js not found)

$ mcphub doctor  # Diagnose all issues
```

### 5. Simplified Management
```bash
$ mcphub list                 # Show all installed servers
$ mcphub list --agent cursor  # Show Cursor's servers only
$ mcphub remove github        # Remove from all agents
$ mcphub enable github --agent windsurf
$ mcphub disable github --agent windsurf
$ mcphub sync cursor windsurf  # Sync config from Cursor to Windsurf
```

### 6. Security Controls
```bash
$ mcphub add github --approval required  # Require manual approval
$ mcphub permissions github              # Show what GitHub server can access
$ mcphub audit                           # Security audit of all servers
```

---

## Technical Architecture

### High-Level Design

```
MCP Hub CLI
    ↓
Registry Aggregator (unified search across all marketplaces)
    ↓
Agent Adapter Layer (translates to agent-specific formats)
    ├─ Cursor Adapter (~/.cursor/mcp.json)
    ├─ Windsurf Adapter (~/.codeium/windsurf/mcp_config.json)
    ├─ Codex Adapter (~/.codex/config.toml)
    ├─ VS Code Adapter (settings.json)
    └─ Claude Desktop Adapter
    ↓
Dependency Manager (npx, uvx, Docker checks)
    ↓
Validation Engine (test configs before applying)
```
---
