"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, type ClusterItem, type NamespaceItem, type NamespaceStats, type DeploymentDetail, type NodeOverview, type ContainerHistory } from "@/lib/api";
import { useSessionState, AUTO_REFRESH_MS, type View } from "@/hooks/useSessionState";
import { STORAGE_KEYS, MANAGED_TOKEN, safeGetItem, safeSetItem, safeRemoveItem, tokenKey } from "@/lib/storage";
import DeploymentCard from "@/components/DeploymentCard";
import SuggestionPanel from "@/components/SuggestionPanel";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import NodeCard from "@/components/NodeCard";
import styles from "./dashboard.module.css";

export default function DashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Capture URL params at mount time as non-reactive refs so mount effects
  // can read the original URL even after router.replace starts rewriting it.
  const initialUrlCluster = useRef(searchParams.get("cluster"));
  const initialUrlView = useRef(searchParams.get("view") as View | null);
  const initialUrlNs = useRef(searchParams.get("ns"));
  const [token, setToken] = useState<string>("");
  const {
    view, setView,
    autoRefresh, setAutoRefresh,
    selectedNs, setSelectedNs,
    timeRange, setTimeRange,
    openCards, setOpenCards,
    excludedNs, setExcludedNs,
  } = useSessionState();

  // Namespace view state
  const [namespaces, setNamespaces] = useState<NamespaceItem[]>([]);
  const [nsStats, setNsStats] = useState<Map<string, NamespaceStats>>(new Map());
  const [deployments, setDeployments] = useState<DeploymentDetail[]>([]);
  const [metricsAvailable, setMetricsAvailable] = useState(true);
  const [prometheusAvailable, setPrometheusAvailable] = useState(false);
  const [loadingNs, setLoadingNs] = useState(true);
  const [loadingDeps, setLoadingDeps] = useState(false);

  // Nodes view state
  const [nodes, setNodes] = useState<NodeOverview[]>([]);
  const [loadingNodes, setLoadingNodes] = useState(false);

  // Namespace-level Prometheus history (eager fetch)
  const [nsHistory, setNsHistory] = useState<ContainerHistory[]>([]);

  // Multi-cluster
  const [cluster, setCluster] = useState("");
  const [clusters, setClusters] = useState<ClusterItem[]>([]);
  const [showClusterMenu, setShowClusterMenu] = useState(false);

  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Workload search
  const [workloadSearch, setWorkloadSearch] = useState("");

  // Stable refs for the auto-refresh interval (avoids stale closures)
  const viewRef = useRef(view);
  const selectedNsRef = useRef(selectedNs);
  const loadingRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // loadNodes / loadDeployments refs updated after each render
  const loadNodesRef = useRef<(silent?: boolean) => Promise<void>>(() => Promise.resolve());
  const loadDeploymentsRef = useRef<(ns: string, silent?: boolean) => Promise<void>>(() => Promise.resolve());

  // Restore cluster and token on mount — URL param takes precedence over sessionStorage.
  useEffect(() => {
    const urlCluster = initialUrlCluster.current;
    const savedCluster = urlCluster ?? safeGetItem(STORAGE_KEYS.cluster) ?? "";
    if (savedCluster) {
      setCluster(savedCluster);
      if (urlCluster) safeSetItem(STORAGE_KEYS.cluster, urlCluster); // sync URL param to storage
    }
    // fall back to legacy "kube-token" for sessions created before per-cluster storage
    const t = safeGetItem(tokenKey(savedCluster)) ?? safeGetItem("kube-token");
    // null = no token at all (redirect to login); empty string or MANAGED_TOKEN = managed cluster (ok)
    if (t === null) { router.replace("/"); return; }
    setToken(t);
  }, [router]);

  // Apply URL-specified view once on mount (runs after useSessionState restores from sessionStorage,
  // since that hook's effects are registered first).
  useEffect(() => {
    const urlView = initialUrlView.current;
    if (urlView === "namespaces" || urlView === "nodes") setView(urlView);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- setView is a stable useState setter

  // Fetch available clusters (for switcher)
  useEffect(() => {
    api.clusters().then(setClusters).catch((e) => console.warn("cluster list unavailable:", e));
  }, []);

  // Keep refs in sync
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { selectedNsRef.current = selectedNs; }, [selectedNs]);

  useEffect(() => {
    if (!token) return;
    setLoadingNs(true);
    api.namespaces(token)
      .then((ns) => {
        setNamespaces(ns);
        // Priority: URL param (first load only) > sessionStorage > first namespace
        const candidateNs = initialUrlNs.current ?? safeGetItem(STORAGE_KEYS.selectedNs);
        initialUrlNs.current = null; // consume once — cluster switches fall back to sessionStorage
        if (candidateNs && ns.some((n) => n.name === candidateNs)) {
          setSelectedNs(candidateNs);
        } else if (ns.length > 0) {
          setSelectedNs(ns[0].name);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingNs(false));
    // Fetch namespace stats in background (best-effort)
    api.namespaceStats(token)
      .then((stats) => setNsStats(new Map(stats.map((s) => [s.name, s]))))
      .catch((e) => console.warn("namespace stats unavailable:", e));
  }, [token, cluster]);

  const loadDeployments = useCallback(async (ns: string, silent = false) => {
    if (!token || !ns) return;
    if (!silent) { setLoadingDeps(true); setError(""); setDeployments([]); setNsHistory([]); }
    loadingRef.current = true;
    try {
      const resp = await api.deployments(token, ns);
      setDeployments(resp.workloads);
      setMetricsAvailable(resp.metricsAvailable);
      setPrometheusAvailable(resp.prometheusAvailable);
      setLastRefresh(new Date());
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : "Failed to load deployments");
    } finally {
      if (!silent) setLoadingDeps(false);
      loadingRef.current = false;
    }
  }, [token, timeRange, cluster]);

  const loadNodes = useCallback(async (silent = false) => {
    if (!token) return;
    if (!silent) { setLoadingNodes(true); setError(""); }
    loadingRef.current = true;
    try {
      const resp = await api.nodes(token);
      setNodes(resp.nodes);
      setPrometheusAvailable(resp.prometheusAvailable);
      setLastRefresh(new Date());
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : "Failed to load nodes");
    } finally {
      if (!silent) setLoadingNodes(false);
      loadingRef.current = false;
    }
  }, [token, cluster]);

  // Keep callback refs up to date so the interval always calls the latest version
  useEffect(() => { loadNodesRef.current = loadNodes; }, [loadNodes]);
  useEffect(() => { loadDeploymentsRef.current = loadDeployments; }, [loadDeployments]);

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
      .catch((e) => console.warn("namespace history unavailable:", e));
  }, [timeRange, token, selectedNs, prometheusAvailable, view]);

  // Auto-refresh interval — paused when tab is hidden or a fetch is already running
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (autoRefresh === "off") return;
    const ms = AUTO_REFRESH_MS[autoRefresh];
    intervalRef.current = setInterval(() => {
      if (document.hidden || loadingRef.current) return;
      if (viewRef.current === "nodes") loadNodesRef.current(true);
      else if (viewRef.current === "namespaces" && selectedNsRef.current) {
        loadDeploymentsRef.current(selectedNsRef.current, true);
      }
    }, ms);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh]);

  function handleRefresh() {
    if (view === "nodes") loadNodes();
    else if (selectedNs) loadDeployments(selectedNs);
  }

  function handleLogout() {
    safeRemoveItem(tokenKey(cluster));
    safeRemoveItem("kube-token"); // clear legacy key too
    safeRemoveItem(STORAGE_KEYS.cluster);
    router.push("/");
  }

  function handleClusterSwitch(name: string) {
    if (name === cluster) { setShowClusterMenu(false); return; }
    const existingToken = safeGetItem(tokenKey(name));
    const targetManaged = clusters.find((c) => c.name === name)?.managed === true;
    safeSetItem(STORAGE_KEYS.cluster, name);
    safeRemoveItem(STORAGE_KEYS.selectedNs);
    setShowClusterMenu(false);

    let newToken: string;
    if (existingToken) {
      // Already authenticated for this cluster in this session.
      newToken = existingToken;
    } else if (targetManaged && token && token !== MANAGED_TOKEN) {
      // OIDC mode: the session JWT is cluster-agnostic — reuse it for the new cluster.
      // The backend validates the JWT then looks up its own SA token per cluster.
      safeSetItem(tokenKey(name), token);
      newToken = token;
    } else if (targetManaged) {
      // Non-OIDC managed SA mode: no user token needed.
      safeSetItem(tokenKey(name), MANAGED_TOKEN);
      newToken = MANAGED_TOKEN;
    } else {
      // No token and cluster is not managed — redirect to login (cluster pre-selected).
      router.push("/");
      return;
    }

    // Switch in-place: update state, let existing effects re-fetch for the new cluster.
    setCluster(name);
    setToken(newToken);
    setSelectedNs("");
    setNamespaces([]);
    setNsStats(new Map());
    setDeployments([]);
    setNodes([]);
    setNsHistory([]);
  }

  function hideNamespace(name: string) {
    setExcludedNs((prev) => {
      const next = new Set(prev);
      next.add(name);
      safeSetItem(STORAGE_KEYS.excludedNs, JSON.stringify([...next]));
      return next;
    });
    // If hiding the currently selected namespace, switch to another
    if (selectedNs === name) {
      const remaining = namespaces.find((ns) => ns.name !== name && !excludedNs.has(ns.name));
      if (remaining) setSelectedNs(remaining.name);
    }
  }

  function restoreNamespace(name: string) {
    setExcludedNs((prev) => {
      const next = new Set(prev);
      next.delete(name);
      safeSetItem(STORAGE_KEYS.excludedNs, JSON.stringify([...next]));
      return next;
    });
  }

  // Keep URL in sync with navigation state so links are shareable.
  // Guarded on cluster being known to avoid overwriting initial URL params before mount effects run.
  useEffect(() => {
    if (!cluster) return;
    const params = new URLSearchParams();
    params.set("cluster", cluster);
    params.set("view", view);
    if (view === "namespaces" && selectedNs) params.set("ns", selectedNs);
    router.replace(`/dashboard?${params.toString()}`);
  }, [cluster, view, selectedNs, router]);

  const scrollTargetRef = useRef<string | null>(null);

  function handleOpenCards(ids: string[], scrollTarget: string) {
    // If workload search would hide the deployment, clear it so the card is rendered
    const depName = ids.find((id) => id.startsWith("dep:"))?.slice(4);
    if (depName && workloadSearch && !depName.toLowerCase().includes(workloadSearch.toLowerCase())) {
      setWorkloadSearch("");
    }
    scrollTargetRef.current = scrollTarget;
    setOpenCards((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }

  // Scroll to target once openCards/workloadSearch update has rendered the target element into DOM.
  // Scoped to [openCards, workloadSearch] to avoid consuming the ref on unrelated renders
  // (auto-refresh, stats load, etc.) before the element exists.
  useEffect(() => {
    if (!scrollTargetRef.current) return;
    const target = scrollTargetRef.current;
    scrollTargetRef.current = null;
    const el = document.getElementById(target);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [openCards, workloadSearch]);

  const visibleDeployments = deployments.filter((dep) =>
    workloadSearch === "" ||
    dep.name.toLowerCase().includes(workloadSearch.toLowerCase()) ||
    dep.pods?.some((p) => p.name.toLowerCase().includes(workloadSearch.toLowerCase()))
  );

  const loading = view === "nodes" ? loadingNodes : loadingDeps;

  return (
    <div className={styles.layout}>
      <Topbar
        cluster={cluster}
        clusters={clusters}
        showClusterMenu={showClusterMenu}
        setShowClusterMenu={setShowClusterMenu}
        onClusterSwitch={handleClusterSwitch}
        lastRefresh={lastRefresh}
        prometheusAvailable={prometheusAvailable}
        timeRange={timeRange}
        setTimeRange={setTimeRange}
        autoRefresh={autoRefresh}
        setAutoRefresh={setAutoRefresh}
        loading={loading}
        onRefresh={handleRefresh}
        onLogout={handleLogout}
      />

      <div className={styles.body}>
        <Sidebar
          view={view}
          setView={setView}
          selectedNs={selectedNs}
          setSelectedNs={setSelectedNs}
          nodes={nodes}
          namespaces={namespaces}
          loadingNs={loadingNs}
          excludedNs={excludedNs}
          onHideNamespace={hideNamespace}
          onRestoreNamespace={restoreNamespace}
        />

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
                  {nodes.map((n) => (
                    <NodeCard
                      key={n.name}
                      node={n}
                      token={token}
                    />
                  ))}
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
                {(() => {
                  const st = nsStats.get(selectedNs);
                  if (!st || (st.cpuRatio === 0 && st.memRatio === 0)) return null;
                  return (
                    <span className={styles.nsRatios}>
                      {st.cpuRatio > 0 && (
                        <span className={styles.nsRatio} style={{ color: st.cpuRatio > 5 ? "var(--red)" : st.cpuRatio > 2 ? "var(--orange)" : "var(--muted)" }} title={`CPU limit/request ratio across all pods in this namespace (${st.cpuRatio.toFixed(1)}×). High values mean limits are set much higher than requests — the namespace may be over-committed.`}>
                          CPU ×{st.cpuRatio.toFixed(1)}
                        </span>
                      )}
                      {st.memRatio > 0 && (
                        <span className={styles.nsRatio} style={{ color: st.memRatio > 5 ? "var(--red)" : st.memRatio > 2 ? "var(--orange)" : "var(--muted)" }} title={`Memory limit/request ratio across all pods in this namespace (${st.memRatio.toFixed(1)}×). High values mean limits are set much higher than requests — the namespace may be over-committed.`}>
                          MEM ×{st.memRatio.toFixed(1)}
                        </span>
                      )}
                    </span>
                  );
                })()}
              </div>
              {error && <p className={styles.error}>{error}</p>}
              {!metricsAvailable && !loadingDeps && (
                <p className={styles.notice}>
                  ⚠ Metrics server unavailable — CPU/memory usage will not be displayed.
                </p>
              )}
              {!loadingDeps && deployments.length > 0 && (
                <input
                  className={styles.workloadSearch}
                  type="text"
                  placeholder="Search workloads or pods…"
                  value={workloadSearch}
                  onChange={(e) => setWorkloadSearch(e.target.value)}
                />
              )}
              {loadingDeps ? (
                <p className={styles.muted}>Loading deployments…</p>
              ) : visibleDeployments.length === 0 ? (
                <p className={styles.muted}>
                  {workloadSearch ? `No workloads matching "${workloadSearch}".` : "No workloads in this namespace."}
                </p>
              ) : (
                <div className={styles.depList}>
                  {visibleDeployments.map((dep) => (
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
        {view === "namespaces" && (
          <SuggestionPanel
            deployments={visibleDeployments}
            history={nsHistory}
            onOpenCards={handleOpenCards}
            searchQuery={workloadSearch}
          />
        )}
      </div>
    </div>
  );
}
