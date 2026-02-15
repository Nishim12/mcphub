import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Search, Plus, ExternalLink, Star, ShieldCheck, Loader2 } from "lucide-react";
import { useRegistrySearch, useUpstreams, useServerActions, stripMd, type RegistryServer } from "./api";

export default function ServerSearch() {
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [envModal, setEnvModal] = useState<RegistryServer | null>(null);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [activeIdx, setActiveIdx] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const { data, isFetching } = useRegistrySearch(debouncedQ);
  const { data: upstreams } = useUpstreams();
  const { add } = useServerActions();
  const configured = new Set(upstreams?.map((u) => u.name) ?? []);

  // Debounce
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Reset active index when results change
  useEffect(() => setActiveIdx(-1), [data]);

  const servers = data?.list ?? [];

  const handleAdd = useCallback(
    (srv: RegistryServer) => {
      if (!srv.run_config?.command) return;
      const rc = srv.run_config;
      const needsEnv = (rc.user_input?.length ?? 0) > 0 || (rc.env?.length ?? 0) > 0;
      if (needsEnv) {
        setEnvModal(srv);
        setEnvValues({});
      } else {
        add.mutate(
          { name: srv.name, command: rc.command, args: rc.args ?? [] },
          { onSuccess: () => toast.success(`Added "${srv.name}"`), onError: (e) => toast.error(e.message) }
        );
      }
    },
    [add]
  );

  const confirmEnvAdd = () => {
    if (!envModal?.run_config) return;
    const rc = envModal.run_config;
    const env = Object.fromEntries(Object.entries(envValues).filter(([, v]) => v.trim()));
    add.mutate(
      { name: envModal.name, command: rc.command, args: rc.args ?? [], ...(Object.keys(env).length ? { env } : {}) },
      {
        onSuccess: () => { toast.success(`Added "${envModal.name}"`); setEnvModal(null); },
        onError: (e) => toast.error(e.message),
      }
    );
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, servers.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, -1)); }
    else if (e.key === "Enter" && activeIdx >= 0 && servers[activeIdx]) { e.preventDefault(); handleAdd(servers[activeIdx]); }
  };

  // Scroll active item into view
  useEffect(() => {
    if (activeIdx >= 0 && listRef.current) {
      const el = listRef.current.children[activeIdx] as HTMLElement | undefined;
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIdx]);

  return (
    <>
      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Search size={15} /> Browse MCP Server Registry
        </h3>

        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-surface mb-1">
          <Search size={14} className="text-zinc-500 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search servers… (github, slack, postgres, filesystem)"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-600"
          />
          {isFetching && <Loader2 size={14} className="animate-spin text-zinc-500 shrink-0" />}
        </div>

        {/* Results list */}
        <div ref={listRef} className="max-h-[360px] overflow-y-auto">
          {query.length < 2 ? (
            <p className="p-6 text-center text-zinc-500 text-sm">Type to search thousands of MCP servers</p>
          ) : servers.length === 0 && !isFetching ? (
            <p className="p-6 text-center text-zinc-500 text-sm">No servers found for "{query}"</p>
          ) : (
            servers.map((srv, i) => (
              <div
                key={srv.id}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => handleAdd(srv)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-colors ${i === activeIdx ? "bg-surface-2" : "hover:bg-surface-2"}`}
              >
                <img
                  src={srv.author_avatar}
                  alt=""
                  className="w-7 h-7 rounded-md bg-zinc-800 shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{srv.name}</span>
                    {srv.metadata?.is_verified && <ShieldCheck size={12} className="text-emerald-500 shrink-0" />}
                    {srv.stars > 0 && (
                      <span className="text-xs text-amber-500 flex items-center gap-0.5 shrink-0">
                        <Star size={10} /> {srv.stars.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 truncate">{stripMd(srv.description)}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {srv.github_url && (
                    <a href={srv.github_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="p-1 rounded hover:bg-zinc-700">
                      <ExternalLink size={13} className="text-zinc-500" />
                    </a>
                  )}
                  {configured.has(srv.name) ? (
                    <span className="text-xs text-zinc-600 px-2 py-0.5 rounded bg-zinc-800">Added</span>
                  ) : srv.run_config?.command ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAdd(srv); }}
                      disabled={add.isPending}
                      className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white transition disabled:opacity-50"
                    >
                      <Plus size={12} /> Add
                    </button>
                  ) : (
                    <span className="text-xs text-zinc-600 italic">No config</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {data && data.total_count > 0 && (
          <p className="text-xs text-zinc-500 mt-2 text-center">{data.total_count.toLocaleString()} servers found</p>
        )}
      </div>

      {/* Env var modal */}
      {envModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setEnvModal(null)}>
          <div className="bg-surface border border-border rounded-xl p-5 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-1">Add "{envModal.name}"</h3>
            <p className="text-xs text-zinc-500 mb-4 line-clamp-2">{stripMd(envModal.description)}</p>
            {(envModal.run_config!.user_input?.length
              ? envModal.run_config!.user_input
              : (envModal.run_config!.env ?? []).map((k) => ({ key: k, description: "", type: "string" }))
            ).map((inp) => (
              <label key={inp.key} className="block mb-3">
                <span className="text-xs text-zinc-400 uppercase tracking-wide">{inp.key}</span>
                <input
                  type="text"
                  placeholder="Enter value…"
                  value={envValues[inp.key] ?? ""}
                  onChange={(e) => setEnvValues((v) => ({ ...v, [inp.key]: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-border bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                />
                {inp.description && <p className="text-xs text-zinc-600 mt-0.5 italic">{inp.description}</p>}
              </label>
            ))}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEnvModal(null)} className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-surface-2">Cancel</button>
              <button onClick={confirmEnvAdd} disabled={add.isPending} className="px-3 py-1.5 text-sm rounded-md bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50">
                {add.isPending ? "Adding…" : "Add Server"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
