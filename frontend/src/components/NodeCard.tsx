"use client";

import { useState, useEffect, useRef } from "react";
import type { NodeOverview, PodDetail } from "@/lib/api";
import { api } from "@/lib/api";
import CircleGauge from "./CircleGauge";
import PodBar from "./PodBar";
import styles from "./NodeCard.module.css";

const TOP_N = 10;

function podSortKey(pod: PodDetail, by: "cpu" | "mem"): number {
  let v = 0;
  for (const c of pod.containers) {
    if (c.usage) {
      v += by === "cpu" ? (c.usage.cpu.millicores ?? 0) : (c.usage.memory.bytes ?? 0);
    } else {
      v += by === "cpu" ? (c.requests.cpu.millicores ?? 0) : (c.requests.memory.bytes ?? 0);
    }
  }
  return v;
}

const TAINT_EFFECT_COLOR: Record<string, string> = {
  NoSchedule:        "rgba(252,129,129,0.15)",
  NoExecute:         "rgba(252,129,129,0.2)",
  PreferNoSchedule:  "rgba(246,166,35,0.12)",
};
const TAINT_EFFECT_BORDER: Record<string, string> = {
  NoSchedule:        "rgba(252,129,129,0.5)",
  NoExecute:         "rgba(252,129,129,0.7)",
  PreferNoSchedule:  "rgba(246,166,35,0.4)",
};

// --- Main card ---

interface NodeCardProps {
  node: NodeOverview;
  token?: string;
}

export default function NodeCard({ node, token }: NodeCardProps) {
  const isReady = node.status === "Ready";
  const statusColor = isReady ? "var(--green)" : node.status === "NotReady" ? "var(--red)" : "var(--yellow)";
  const isControlPlane = node.roles.includes("control-plane");

  const [podsOpen, setPodsOpen] = useState(false);
  const [pods, setPods] = useState<PodDetail[] | null>(null);
  const [loadingPods, setLoadingPods] = useState(false);
  const [sortBy, setSortBy] = useState<"cpu" | "mem">("cpu");
  const fetchedRef = useRef(false);

  // Fetch pods on first expand
  useEffect(() => {
    if (!podsOpen || !token || fetchedRef.current) return;
    fetchedRef.current = true;
    setLoadingPods(true);
    api.nodePods(token, node.name)
      .then(setPods)
      .catch(() => setPods([]))
      .finally(() => setLoadingPods(false));
  }, [podsOpen, token, node.name]);

  const allocCPU = node.allocatable.cpu.millicores ?? 0;
  const allocMem = node.allocatable.memory.bytes ?? 0;

  const topPods = pods
    ? [...pods].sort((a, b) => podSortKey(b, sortBy) - podSortKey(a, sortBy)).slice(0, TOP_N)
    : [];

  return (
    <div className={`${styles.card} ${!isReady ? styles.notReady : ""}`}>
      {/* Header row 1: identity */}
      <div className={styles.headerTop}>
        <span className={styles.nodeIcon}>⬡</span>
        <span className={styles.nodeName}>{node.name}</span>
        <span className={styles.statusBadge} style={{ color: statusColor, borderColor: statusColor }}>
          {node.status}
        </span>
        {node.roles.map((r) => (
          <span key={r} className={`${styles.roleBadge} ${isControlPlane ? styles.controlPlane : ""}`}>
            {r}
          </span>
        ))}
        <span className={styles.podCountBadge} title="Running pods / max pods">{node.podCount} / {node.maxPods}</span>
      </div>

      {/* Header row 2: metadata */}
      <div className={styles.headerMeta}>
        {node.age && <span className={styles.metaItem} title="Node age">{node.age}</span>}
        {node.osImage && <span className={styles.metaItem} title="OS image">{node.osImage}</span>}
        {node.kernelVersion && <span className={styles.metaItem} title="Kernel version">kernel {node.kernelVersion}</span>}
      </div>

      {/* Pressures + taints */}
      {(node.diskPressure || node.memoryPressure || node.pidPressure || (node.taints?.length ?? 0) > 0) && (
        <div className={styles.alertRow}>
          {node.diskPressure && <span className={styles.pressureBadge} title="DiskPressure condition is True">disk pressure</span>}
          {node.memoryPressure && <span className={styles.pressureBadge} title="MemoryPressure condition is True">memory pressure</span>}
          {node.pidPressure && <span className={styles.pressureBadge} title="PIDPressure condition is True">pid pressure</span>}
          {node.taints?.map((t, i) => {
            const shortKey = t.key.includes("/") ? (t.key.split("/").pop() ?? t.key) : t.key;
            return (
              <span
                key={i}
                className={styles.taintBadge}
                style={{
                  background: TAINT_EFFECT_COLOR[t.effect] ?? "var(--surface2)",
                  borderColor: TAINT_EFFECT_BORDER[t.effect] ?? "var(--border)",
                }}
                title={`${t.value ? `${t.key}=${t.value}` : t.key} · ${t.effect}`}
              >
                {shortKey}{t.value ? `=${t.value}` : ""} · {t.effect}
              </span>
            );
          })}
        </div>
      )}

      {/* Resources */}
      {isReady ? (
        <div className={styles.resources}>
          <CircleGauge label="CPU" allocatable={node.allocatable.cpu} requested={node.requested.cpu} limited={node.limited.cpu} usage={node.usage?.cpu} isCPU={true} />
          <CircleGauge label="Memory" allocatable={node.allocatable.memory} requested={node.requested.memory} limited={node.limited.memory} usage={node.usage?.memory} isCPU={false} />
        </div>
      ) : (
        <div className={styles.notReadyMsg}>Node is not ready — no resource data available</div>
      )}

      {/* Top pods — on demand */}
      {token && (
        <div className={styles.podBarsSection}>
          <div className={styles.podsToggleRow}>
            <button
              className={styles.podsToggle}
              type="button"
              onClick={() => setPodsOpen((v) => !v)}
              aria-expanded={podsOpen}
            >
              <span className={styles.podsArrow}>{podsOpen ? "▾" : "▸"}</span>
              Top pods
              {pods && <span className={styles.podCount}>{pods.length}</span>}
            </button>
            {podsOpen && (
              <div className={styles.sortToggle}>
                <button
                  type="button"
                  className={`${styles.sortBtn} ${sortBy === "cpu" ? styles.sortBtnActive : ""}`}
                  onClick={() => setSortBy("cpu")}
                >CPU</button>
                <button
                  type="button"
                  className={`${styles.sortBtn} ${sortBy === "mem" ? styles.sortBtnActive : ""}`}
                  onClick={() => setSortBy("mem")}
                >MEM</button>
              </div>
            )}
          </div>

          {podsOpen && (
            <>
              {loadingPods && <p className={styles.podsLoading}>Loading pods…</p>}

              {pods && pods.length > 0 && (
                <>
                  {pods.length > TOP_N && (
                    <p className={styles.topInfo}>
                      Top {TOP_N} of {pods.length} · sorted by {sortBy === "cpu" ? "CPU" : "memory"} use
                    </p>
                  )}
                  <div className={styles.podBarsList}>
                    {topPods.map((pod) => (
                      <PodBar key={pod.name} pod={pod} allocCPU={allocCPU} allocMem={allocMem} />
                    ))}
                  </div>
                </>
              )}

              {pods && pods.length === 0 && !loadingPods && (
                <p className={styles.podsLoading}>No active pods on this node.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
