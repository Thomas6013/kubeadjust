"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, type NamespaceItem, type DeploymentDetail, type NodeOverview } from "@/lib/api";
import DeploymentCard from "@/components/DeploymentCard";
import SuggestionPanel from "@/components/SuggestionPanel";
import NodeCard from "@/components/NodeCard";
import styles from "./dashboard.module.css";

type View = "namespaces" | "nodes";

export default function DashboardPage() {
  const router = useRouter();
  const [token, setToken] = useState<string>("");
  const [view, setView] = useState<View>("namespaces");

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

  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  useEffect(() => {
    const t = sessionStorage.getItem("kube-token");
    if (!t) { router.replace("/"); return; }
    setToken(t);
  }, [router]);

  useEffect(() => {
    if (!token) return;
    setLoadingNs(true);
    api.namespaces(token)
      .then((ns) => {
        setNamespaces(ns);
        if (ns.length > 0) setSelectedNs(ns[0].name);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingNs(false));
  }, [token]);

  const loadDeployments = useCallback(async (ns: string) => {
    if (!token || !ns) return;
    setLoadingDeps(true);
    setError("");
    try {
      const resp = await api.deployments(token, ns);
      setDeployments(resp.workloads);
      setMetricsAvailable(resp.metricsAvailable);
      setPrometheusAvailable(resp.prometheusAvailable);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load deployments");
    } finally {
      setLoadingDeps(false);
    }
  }, [token]);

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

  function handleRefresh() {
    if (view === "nodes") loadNodes();
    else if (selectedNs) loadDeployments(selectedNs);
  }

  function handleLogout() {
    sessionStorage.removeItem("kube-token");
    router.push("/");
  }

  const loading = view === "nodes" ? loadingNodes : loadingDeps;

  return (
    <div className={styles.layout}>
      <header className={styles.topbar}>
        <div className={styles.brand}><span>⎈</span> KubeAdjust</div>
        <div className={styles.actions}>
          {lastRefresh && <span className={styles.refreshed}>Refreshed {lastRefresh.toLocaleTimeString()}</span>}
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
            <ul className={styles.nsList}>
              {namespaces.map((ns) => (
                <li key={ns.name}>
                  <button
                    className={`${styles.nsBtn} ${view === "namespaces" && selectedNs === ns.name ? styles.active : ""}`}
                    onClick={() => { setView("namespaces"); setSelectedNs(ns.name); }}
                  >
                    {ns.name}
                  </button>
                </li>
              ))}
            </ul>
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
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </main>

        {/* Suggestions — only in namespace view */}
        {view === "namespaces" && <SuggestionPanel deployments={deployments} />}
      </div>
    </div>
  );
}
