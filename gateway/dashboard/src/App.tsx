import { useState } from "react";
import { toast } from "sonner";
import {
  Activity, Server, Wrench, Play, BarChart3, Power, RotateCcw, Trash2, Circle,
} from "lucide-react";
import {
  useHealth, useStats, useTools, useUpstreams, useServerActions,
  type Upstream, type Tool,
} from "./api";
import ServerSearch from "./ServerSearch";

// ---- Tiny helpers ----
const Badge = ({ status }: { status: string }) => {
  const colors: Record<string, string> = {
    connected: "bg-emerald-500/15 text-emerald-400",
    disconnected: "bg-red-500/15 text-red-400",
    error: "bg-red-500/15 text-red-400",
    disabled: "bg-zinc-500/15 text-zinc-500",
    closed: "bg-emerald-500/15 text-emerald-400",
    open: "bg-red-500/15 text-red-400",
    "half-open": "bg-amber-500/15 text-amber-400",
  };
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${colors[status] ?? "bg-zinc-700 text-zinc-400"}`}>{status}</span>;
};

const Stat = ({ label, value, color = "text-zinc-100" }: { label: string; value: string | number; color?: string }) => (
  <div className="bg-surface border border-border rounded-lg p-4">
    <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">{label}</p>
    <p className={`text-2xl font-bold ${color}`}>{value}</p>
  </div>
);

const tabs = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "servers", label: "Servers", icon: Server },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "playground", label: "Playground", icon: Play },
  { id: "stats", label: "Stats", icon: BarChart3 },
] as const;

type TabId = (typeof tabs)[number]["id"];

export default function App() {
  const [tab, setTab] = useState<TabId>("overview");
  const health = useHealth();
  const stats = useStats();
  const tools = useTools();
  const upstreams = useUpstreams();

  const h = health.data;
  const online = (h?.healthy ?? 0) > 0;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <header className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h1 className="text-lg font-bold tracking-tight">
          MCP Gateway <span className="text-indigo-400 font-normal">Dashboard</span>
        </h1>
        <div className="flex items-center gap-4 text-sm text-zinc-500">
          <span className="flex items-center gap-1.5">
            <Circle size={8} className={online ? "fill-emerald-500 text-emerald-500" : "fill-red-500 text-red-500"} />
            {online ? "Online" : "Offline"}
          </span>
          {h && <span>v{h.version}</span>}
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex gap-1 border-b border-border mb-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 transition ${
              tab === t.id ? "border-indigo-500 text-indigo-400" : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      {tab === "overview" && <OverviewTab />}
      {tab === "servers" && <ServersTab />}
      {tab === "tools" && <ToolsTab />}
      {tab === "playground" && <PlaygroundTab />}
      {tab === "stats" && <StatsTab />}
    </div>
  );

  // ================ OVERVIEW ================
  function OverviewTab() {
    const s = stats.data;
    const t = tools.data ?? [];
    const u = upstreams.data ?? [];
    const topTools = s?.analysis?.topTools ?? [];

    return (
      <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat label="Total Servers" value={h?.total ?? "-"} color="text-blue-400" />
          <Stat label="Healthy" value={h?.healthy ?? "-"} color="text-emerald-400" />
          <Stat label="Total Tools" value={t.length} />
          <Stat label="Token Overhead" value={(s?.analysis?.totalTokens ?? 0).toLocaleString()} color="text-amber-400" />
        </div>
        <Panel title="Server Status">
          <Table heads={["Name", "Status", "Circuit", "Tools"]}>
            {u.map((srv) => (
              <tr key={srv.name} className="hover:bg-surface-2">
                <td className="px-3 py-2 font-medium">{srv.name}</td>
                <td className="px-3 py-2"><Badge status={srv.status} /></td>
                <td className="px-3 py-2"><Badge status={srv.circuit?.state ?? "-"} /></td>
                <td className="px-3 py-2">{s?.servers?.[srv.name]?.toolCount ?? "-"}</td>
              </tr>
            ))}
          </Table>
        </Panel>
        <Panel title="Top Tools">
          <Table heads={["Tool", "Server", "Calls", "Avg Latency"]}>
            {topTools.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-4 text-center text-zinc-600">No tool calls recorded yet.</td></tr>
            ) : topTools.slice(0, 10).map((t) => (
              <tr key={t.tool + t.server} className="hover:bg-surface-2">
                <td className="px-3 py-2 font-mono text-xs">{t.tool}</td>
                <td className="px-3 py-2">{t.server}</td>
                <td className="px-3 py-2">{t.calls}</td>
                <td className="px-3 py-2">{t.avgLatencyMs}ms</td>
              </tr>
            ))}
          </Table>
        </Panel>
      </>
    );
  }

  // ================ SERVERS ================
  function ServersTab() {
    const u = upstreams.data ?? [];
    const { toggle, restart, remove } = useServerActions();
    const [manual, setManual] = useState(false);
    const [name, setName] = useState("");
    const [cmd, setCmd] = useState("");
    const [args, setArgs] = useState("");
    const { add } = useServerActions();

    const handleManualAdd = () => {
      if (!name || !cmd) return toast.error("Name and command required");
      add.mutate(
        { name, command: cmd, args: args ? args.split(",").map((s) => s.trim()) : [] },
        { onSuccess: () => { toast.success(`Added "${name}"`); setName(""); setCmd(""); setArgs(""); }, onError: (e) => toast.error(e.message) }
      );
    };

    return (
      <>
        {/* Mode toggle */}
        <div className="flex gap-1 mb-4">
          <button
            onClick={() => setManual(false)}
            className={`px-3 py-1.5 text-xs rounded-md border transition ${!manual ? "bg-indigo-600 border-indigo-600 text-white" : "border-border text-zinc-400 hover:text-zinc-200"}`}
          >
            Browse Registry
          </button>
          <button
            onClick={() => setManual(true)}
            className={`px-3 py-1.5 text-xs rounded-md border transition ${manual ? "bg-indigo-600 border-indigo-600 text-white" : "border-border text-zinc-400 hover:text-zinc-200"}`}
          >
            Manual
          </button>
        </div>

        {manual ? (
          <div className="rounded-lg border border-border bg-surface p-4 mb-6">
            <h3 className="text-sm font-semibold mb-3">Add Server Manually</h3>
            <div className="flex flex-wrap gap-2 items-end">
              <label className="text-xs text-zinc-500">
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="github" className="mt-1 block w-36 rounded-md border border-border bg-zinc-950 px-3 py-1.5 text-sm outline-none focus:border-indigo-500" />
              </label>
              <label className="text-xs text-zinc-500">
                Command
                <input value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="npx" className="mt-1 block w-28 rounded-md border border-border bg-zinc-950 px-3 py-1.5 text-sm outline-none focus:border-indigo-500" />
              </label>
              <label className="text-xs text-zinc-500 flex-1 min-w-[200px]">
                Args (comma-separated)
                <input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y,@modelcontextprotocol/server-github" className="mt-1 block w-full rounded-md border border-border bg-zinc-950 px-3 py-1.5 text-sm outline-none focus:border-indigo-500" />
              </label>
              <button onClick={handleManualAdd} disabled={add.isPending} className="px-4 py-1.5 text-sm rounded-md bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50">
                Add
              </button>
            </div>
          </div>
        ) : (
          <div className="mb-6"><ServerSearch /></div>
        )}

        <Panel title={`Configured Servers (${u.length})`}>
          <Table heads={["Name", "Command", "Status", "Circuit", "Enabled", "Actions"]}>
            {u.map((srv) => (
              <tr key={srv.name} className="hover:bg-surface-2">
                <td className="px-3 py-2 font-medium">{srv.name}</td>
                <td className="px-3 py-2 font-mono text-xs truncate max-w-[250px]">{srv.command} {srv.args?.join(" ")}</td>
                <td className="px-3 py-2"><Badge status={srv.status} /></td>
                <td className="px-3 py-2"><Badge status={srv.circuit?.state ?? "-"} /></td>
                <td className="px-3 py-2">
                  <button onClick={() => toggle.mutate(srv.name)} className={`w-9 h-5 rounded-full transition relative ${srv.enabled ? "bg-emerald-500" : "bg-zinc-700"}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${srv.enabled ? "left-[18px]" : "left-0.5"}`} />
                  </button>
                </td>
                <td className="px-3 py-2 flex gap-1">
                  <button onClick={() => restart.mutate(srv.name)} className="p-1.5 rounded hover:bg-zinc-800" title="Restart"><RotateCcw size={13} /></button>
                  <button onClick={() => { if (confirm(`Remove "${srv.name}"?`)) remove.mutate(srv.name); }} className="p-1.5 rounded hover:bg-red-500/20 text-red-400" title="Remove"><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
          </Table>
        </Panel>
      </>
    );
  }

  // ================ TOOLS ================
  function ToolsTab() {
    const [q, setQ] = useState("");
    const t = (tools.data ?? []).filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()) || (t.description ?? "").toLowerCase().includes(q.toLowerCase()));

    return (
      <>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tools…"
          className="mb-4 w-full max-w-sm rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
        <Panel title={`All Tools (${t.length})`}>
          <Table heads={["Name", "Description", "Parameters", ""]}>
            {t.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-4 text-center text-zinc-600">No tools found.</td></tr>
            ) : t.map((tool) => (
              <tr key={tool.name} className="hover:bg-surface-2">
                <td className="px-3 py-2 font-mono text-xs">{tool.name}</td>
                <td className="px-3 py-2 text-xs text-zinc-400 max-w-[300px] truncate">{tool.description ?? "-"}</td>
                <td className="px-3 py-2 text-xs">{tool.inputSchema?.properties ? Object.keys(tool.inputSchema.properties).join(", ") : "-"}</td>
                <td className="px-3 py-2">
                  <button onClick={() => { setTab("playground"); setTimeout(() => { const s = document.getElementById("pg-select") as HTMLSelectElement; if (s) s.value = tool.name; }, 50); }}
                    className="text-xs text-indigo-400 hover:underline">Test</button>
                </td>
              </tr>
            ))}
          </Table>
        </Panel>
      </>
    );
  }

  // ================ PLAYGROUND ================
  function PlaygroundTab() {
    const t = tools.data ?? [];
    const { callTool } = useServerActions();
    const [selected, setSelected] = useState("");
    const [argsText, setArgsText] = useState("{}");
    const [result, setResult] = useState<string>("No response yet.");

    const tool = t.find((x) => x.name === selected);

    const onSelect = (name: string) => {
      setSelected(name);
      const tt = t.find((x) => x.name === name);
      if (tt?.inputSchema?.properties) {
        const tmpl: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(tt.inputSchema.properties)) tmpl[k] = v.default ?? `<${v.type ?? "any"}>`;
        setArgsText(JSON.stringify(tmpl, null, 2));
      } else setArgsText("{}");
    };

    const run = () => {
      if (!selected) return;
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(argsText); } catch (e) { setResult("Invalid JSON: " + (e as Error).message); return; }
      setResult("Calling…");
      callTool.mutate(
        { name: selected, arguments: parsed },
        { onSuccess: (d) => setResult(JSON.stringify(d, null, 2)), onError: (e) => setResult("Error: " + e.message) }
      );
    };

    return (
      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold mb-3">Tool Playground</h3>
        <div className="flex flex-wrap gap-2 items-end mb-4">
          <select
            id="pg-select"
            value={selected}
            onChange={(e) => onSelect(e.target.value)}
            className="rounded-md border border-border bg-zinc-950 px-3 py-1.5 text-sm outline-none min-w-[250px]"
          >
            <option value="">Select a tool…</option>
            {t.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
          </select>
          <button onClick={run} disabled={!selected || callTool.isPending} className="px-4 py-1.5 text-sm rounded-md bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50">
            Execute
          </button>
        </div>
        {tool?.description && <p className="text-xs text-zinc-500 mb-3">{tool.description}</p>}
        <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wide">Arguments (JSON)</label>
        <textarea
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-border bg-zinc-950 px-3 py-2 text-sm font-mono outline-none focus:border-indigo-500 resize-y mb-4"
        />
        <label className="block text-xs text-zinc-500 mb-1 uppercase tracking-wide">Response</label>
        <pre className="rounded-md border border-border bg-zinc-950 p-3 text-xs font-mono text-zinc-400 max-h-80 overflow-auto whitespace-pre-wrap">
          {result}
        </pre>
      </div>
    );
  }

  // ================ STATS ================
  function StatsTab() {
    const s = stats.data;
    if (!s?.analysis) return <p className="text-zinc-500">Loading stats…</p>;
    const a = s.analysis;
    const dead = a.deadTools ?? [];
    const maxTokens = Math.max(...Object.values(s.servers).map((x) => x.toolListTokenEstimate ?? 0), 1);

    return (
      <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat label="Total Tokens" value={a.totalTokens.toLocaleString()} color="text-blue-400" />
          <Stat label="Wasted Tokens" value={a.wastedTokens.toLocaleString()} color="text-red-400" />
          <Stat label="Waste %" value={`${a.wastedPercent}%`} color="text-amber-400" />
          <Stat label="Error-Prone Tools" value={a.errorProne.length} color="text-red-400" />
        </div>
        <Panel title={`Dead Tools (${dead.length})`}>
          <p className="text-xs text-zinc-600 mb-2 px-3">Tools consuming context tokens but never called.</p>
          <Table heads={["Tool", "Server", "Token Cost"]}>
            {dead.length === 0 ? (
              <tr><td colSpan={3} className="px-3 py-4 text-center text-zinc-600">All tools are being used.</td></tr>
            ) : dead.map((d) => (
              <tr key={d.tool + d.server} className="hover:bg-surface-2">
                <td className="px-3 py-2 font-mono text-xs">{d.tool}</td>
                <td className="px-3 py-2">{d.server}</td>
                <td className="px-3 py-2">{d.tokenCost}</td>
              </tr>
            ))}
          </Table>
        </Panel>
        <Panel title="Per-Server Token Overhead">
          <div className="space-y-2 p-3">
            {Object.entries(s.servers).map(([name, srv]) => (
              <div key={name} className="flex items-center gap-3 text-xs">
                <span className="w-28 text-zinc-500 truncate">{name}</span>
                <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.round((srv.toolListTokenEstimate / maxTokens) * 100)}%` }} />
                </div>
                <span className="font-semibold w-16 text-right">{srv.toolListTokenEstimate.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Error-Prone Tools">
          <Table heads={["Tool", "Server", "Failure Rate", "Failures"]}>
            {a.errorProne.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-4 text-center text-zinc-600">No error-prone tools.</td></tr>
            ) : a.errorProne.map((e) => (
              <tr key={e.tool + e.server} className="hover:bg-surface-2">
                <td className="px-3 py-2 font-mono text-xs">{e.tool}</td>
                <td className="px-3 py-2">{e.server}</td>
                <td className="px-3 py-2">{e.failureRate}%</td>
                <td className="px-3 py-2">{e.failures}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      </>
    );
  }
}

// ---- Shared tiny components ----
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 mb-4">
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Table({ heads, children }: { heads: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {heads.map((h) => (
              <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-zinc-500 uppercase tracking-wide border-b border-border">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
