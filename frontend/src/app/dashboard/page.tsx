"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, type NamespaceItem, type DeploymentDetail, type NodeOverview, type TimeRange, type ContainerHistory } from "@/lib/api";
import DeploymentCard from "@/components/DeploymentCard";
import SuggestionPanel from "@/components/SuggestionPanel";
import NodeCard from "@/components/NodeCard";
import styles from "./dashboard.module.css";

type View = "namespaces" | "nodes";

export default function DashboardPage() {
  const router = useRouter();
  const [token, setToken] = useState<string>("");
  const [view, setView] = useState<View>("nodes");

  // Namespace view state
  const [namespaces, setNamespaces] = useState<NamespaceItem[]>([]);
  const [selectedNs, setSelectedNs] = useState<string>("");
  const [deployments, setDeployments] = useState<DeploymentDetail[]>([]);
  const [metricsAvailable, setMetricsAvailable] = useState(true);
  const [prometheusAvailable, setPrometheusAvailable] = useState(false);
  const [loadingNs, setLoadingNs] = useState(true);
  const [loadingDeps, setLoadingDeps] = useState(false);

  // Nodes view state
  const [nodes, setNodes] = useState<NodeOverview[]>([]);
  const [loadingNodes, setLoadingNodes] = useState(false);

  // Namespace exclusion (persisted in sessionStorage)
  const [excludedNs, setExcludedNs] = useState<Set<string>>(new Set());

  // Time range for Prometheus queries
  const [timeRange, setTimeRange] = useState<TimeRange>("1h");

  // Namespace-level Prometheus history (eager fetch)
  const [nsHistory, setNsHistory] = useState<ContainerHistory[]>([]);

  // Opened deployments/pods (persisted in sessionStorage)
  const [openCards, setOpenCards] = useState<Set<string>>(new Set());

  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Persist view/namespace/timeRange on change
  useEffect(() => { sessionStorage.setItem("kubeadjust:view", view); }, [view]);
  useEffect(() => { if (selectedNs) sessionStorage.setItem("kubeadjust:selectedNs", selectedNs); }, [selectedNs]);
  useEffect(() => { sessionStorage.setItem("kubeadjust:timeRange", timeRange); }, [timeRange]);
  useEffect(() => { sessionStorage.setItem("kubeadjust:openCards", JSON.stringify([...openCards])); }, [openCards]);

  useEffect(() => {
    const t = sessionStorage.getItem("kube-token");
    if (!t) { router.replace("/"); return; }
    setToken(t);
    // Restore persisted state
    try {
      const raw = sessionStorage.getItem("kubeadjust:excludedNs");
      if (raw) setExcludedNs(new Set(JSON.parse(raw) as string[]));
    } catch { /* ignore */ }
    const savedView = sessionStorage.getItem("kubeadjust:view") as View | null;
    if (savedView) setView(savedView);
    const savedNs = sessionStorage.getItem("kubeadjust:selectedNs");
    if (savedNs) setSelectedNs(savedNs);
    const savedRange = sessionStorage.getItem("kubeadjust:timeRange") as TimeRange | null;
    if (savedRange) setTimeRange(savedRange);
    try {
      const rawCards = sessionStorage.getItem("kubeadjust:openCards");
      if (rawCards) setOpenCards(new Set(JSON.parse(rawCards) as string[]));
    } catch { /* ignore */ }
  }, [router]);

  useEffect(() => {
    if (!token) return;
    setLoadingNs(true);
    api.namespaces(token)
      .then((ns) => {
        setNamespaces(ns);
        // Keep persisted namespace if it still exists, otherwise pick first
        const saved = sessionStorage.getItem("kubeadjust:selectedNs");
        if (saved && ns.some((n) => n.name === saved)) {
          setSelectedNs(saved);
        } else if (ns.length > 0) {
          setSelectedNs(ns[0].name);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingNs(false));
  }, [token]);

  const loadDeployments = useCallback(async (ns: string) => {
    if (!token || !ns) return;
    setLoadingDeps(true);
    setError("");
    setNsHistory([]);
    try {
      const resp = await api.deployments(token, ns);
      setDeployments(resp.workloads);
      setMetricsAvailable(resp.metricsAvailable);
      setPrometheusAvailable(resp.prometheusAvailable);
      setLastRefresh(new Date());
      // Eager fetch Prometheus history for suggestions
      if (resp.prometheusAvailable) {
        api.namespaceHistory(token, ns, timeRange)
          .then((h) => setNsHistory(h.containers))
          .catch(() => { /* best-effort */ });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load deployments");
    } finally {
      setLoadingDeps(false);
    }
  }, [token, timeRange]);

  const loadNodes = useCallback(async () => {
    if (!token) return;
    setLoadingNodes(true);
    setError("");
    try {
      const n = await api.nodes(token);
      setNodes(n);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load nodes");
    } finally {
      setLoadingNodes(false);
    }
  }, [token]);

  useEffect(() => {
    if (selectedNs && view === "namespaces") loadDeployments(selectedNs);
  }, [selectedNs, loadDeployments, view]);

  useEffect(() => {
    if (token && view === "nodes" && nodes.length === 0) loadNodes();
  }, [view, token, loadNodes, nodes.length]);

  // Re-fetch history when time range changes
  useEffect(() => {
    if (!token || !selectedNs || !prometheusAvailable || view !== "namespaces") return;
    api.namespaceHistory(token, selectedNs, timeRange)
      .then((h) => setNsHistory(h.containers))
      .catch(() => { /* best-effort */ });
  }, [timeRange, token, selectedNs, prometheusAvailable, view]);

  function handleRefresh() {
    if (view === "nodes") loadNodes();
    else if (selectedNs) loadDeployments(selectedNs);
  }

  function handleLogout() {
    sessionStorage.removeItem("kube-token");
    router.push("/");
  }

  function hideNamespace(name: string) {
    setExcludedNs((prev) => {
      const next = new Set(prev);
      next.add(name);
      sessionStorage.setItem("kubeadjust:excludedNs", JSON.stringify([...next]));
      return next;
    });
    // If hiding the currently selected namespace, switch to another
    if (selectedNs === name) {
      const remaining = namespaces.find((ns) => ns.name !== name && !excludedNs.has(ns.name));
      if (remaining) setSelectedNs(remaining.name);
    }
  }


  const [nsSearch, setNsSearch] = useState("");

  const visibleNamespaces = namespaces
    .filter((ns) => !excludedNs.has(ns.name))
    .filter((ns) => ns.name.toLowerCase().includes(nsSearch.toLowerCase()));

  const hiddenNamespaces = namespaces.filter((ns) => excludedNs.has(ns.name));

  const loading = view === "nodes" ? loadingNodes : loadingDeps;

  return (
    <div className={styles.layout}>
      <header className={styles.topbar}>
        <div className={styles.brand}><span>⎈</span> KubeAdjust</div>
        <div className={styles.actions}>
          {lastRefresh && <span className={styles.refreshed}>Refreshed {lastRefresh.toLocaleTimeString()}</span>}
          <div className={styles.rangeSelector}>
            {(["1h", "6h", "24h", "7d"] as TimeRange[]).map((r) => (
              <button
                key={r}
                className={`${styles.rangeBtn} ${timeRange === r ? styles.rangeBtnActive : ""}`}
                onClick={() => setTimeRange(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <button className="ghost" onClick={handleRefresh} disabled={loading}>
            {loading ? "Loading…" : "↺ Refresh"}
          </button>
          <button className="ghost" onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      <div className={styles.body}>
        {/* Sidebar */}
        <aside className={styles.sidebar}>
          {/* Cluster section */}
          <p className={styles.sidebarTitle}>Cluster</p>
          <ul className={styles.nsList}>
            <li>
              <button
                className={`${styles.nsBtn} ${styles.nodeBtn} ${view === "nodes" ? styles.active : ""}`}
                onClick={() => setView("nodes")}
              >
                ⬡ Nodes
                {nodes.length > 0 && (
                  <span className={styles.nodeBadge}>
                    {nodes.filter((n) => n.status === "Ready").length}/{nodes.length}
                  </span>
                )}
              </button>
            </li>
          </ul>

          {/* Namespaces section */}
          <p className={styles.sidebarTitle} style={{ marginTop: 20 }}>Namespaces</p>
          {loadingNs ? (
            <p className={styles.muted}>Loading…</p>
          ) : (
            <>
              <input
                className={styles.nsSearch}
                type="text"
                placeholder="Search namespaces…"
                value={nsSearch}
                onChange={(e) => setNsSearch(e.target.value)}
              />
              <ul className={styles.nsList}>
                {visibleNamespaces.map((ns) => (
                  <li key={ns.name} className={styles.nsRow}>
                    <button
                      className={`${styles.nsBtn} ${view === "namespaces" && selectedNs === ns.name ? styles.active : ""}`}
                      onClick={() => { setView("namespaces"); setSelectedNs(ns.name); }}
                    >
                      {ns.name}
                    </button>
                    <button
                      className={styles.nsHide}
                      onClick={(e) => { e.stopPropagation(); hideNamespace(ns.name); }}
                      title={`Hide ${ns.name}`}
                    >✕</button>
                  </li>
                ))}
              </ul>
              {hiddenNamespaces.length > 0 && (
                <details className={styles.hiddenSection}>
                  <summary className={styles.hiddenSummary}>
                    {hiddenNamespaces.length} hidden
                  </summary>
                  <ul className={styles.nsList}>
                    {hiddenNamespaces.map((ns) => (
                      <li key={ns.name} className={styles.nsRow}>
                        <span className={styles.hiddenName}>{ns.name}</span>
                        <button
                          className={styles.nsRestore}
                          onClick={() => {
                            setExcludedNs((prev) => {
                              const next = new Set(prev);
                              next.delete(ns.name);
                              sessionStorage.setItem("kubeadjust:excludedNs", JSON.stringify([...next]));
                              return next;
                            });
                          }}
                          title={`Restore ${ns.name}`}
                        >+</button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </aside>

        {/* Main content */}
        <main className={styles.main}>
          {view === "nodes" ? (
            <>
              <div className={styles.mainHeader}>
                <h2>Node overview</h2>
                <span className={styles.count}>{nodes.length} node{nodes.length !== 1 ? "s" : ""}</span>
                {nodes.filter((n) => n.status !== "Ready").length > 0 && (
                  <span style={{ color: "var(--red)", fontSize: 13 }}>
                    ⚠ {nodes.filter((n) => n.status !== "Ready").length} not ready
                  </span>
                )}
              </div>
              {error && <p className={styles.error}>{error}</p>}
              {loadingNodes ? (
                <p className={styles.muted}>Loading nodes…</p>
              ) : (
                <div className={styles.nodeGrid}>
                  {nodes.map((n) => <NodeCard key={n.name} node={n} />)}
                </div>
              )}
            </>
          ) : (
            <>
              <div className={styles.mainHeader}>
                <h2>{selectedNs || "—"}</h2>
                <span className={styles.count}>
                  {deployments.length} workload{deployments.length !== 1 ? "s" : ""}
                </span>
              </div>
              {error && <p className={styles.error}>{error}</p>}
              {!metricsAvailable && !loadingDeps && (
                <p className={styles.notice}>
                  ⚠ Metrics server unavailable — CPU/memory usage will not be displayed.
                </p>
              )}
              {loadingDeps ? (
                <p className={styles.muted}>Loading deployments…</p>
              ) : deployments.length === 0 ? (
                <p className={styles.muted}>No workloads in this namespace.</p>
              ) : (
                <div className={styles.depList}>
                  {deployments.map((dep) => (
                    <DeploymentCard
                      key={dep.name}
                      dep={dep}
                      namespace={selectedNs}
                      prometheusAvailable={prometheusAvailable}
                      token={token}
                      timeRange={timeRange}
                      openCards={openCards}
                      onToggleCard={(id) => setOpenCards((prev) => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id); else next.add(id);
                        return next;
                      })}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </main>

        {/* Suggestions — only in namespace view */}
        {view === "namespaces" && <SuggestionPanel deployments={deployments} history={nsHistory} />}
      </div>
    </div>
  );
}
