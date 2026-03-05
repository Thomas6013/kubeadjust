"use client";

import { useState, useEffect, useRef } from "react";
import type { NodeOverview, ResourceValue, PodDetail } from "@/lib/api";
import { api, fmtCPU, fmtMemory } from "@/lib/api";
import styles from "./NodeCard.module.css";

// --- helpers ---

function pct(a: ResourceValue, b: ResourceValue, isCPU: boolean): number {
  const av = isCPU ? (a.millicores ?? 0) : (a.bytes ?? 0);
  const bv = isCPU ? (b.millicores ?? 0) : (b.bytes ?? 0);
  if (bv === 0) return 0;
  return Math.min(100, Math.round((av / bv) * 100));
}

function gaugeColor(p: number): string {
  if (p >= 90) return "var(--red)";
  if (p >= 70) return "var(--orange)";
  if (p <= 20) return "var(--blue-over)";
  return "var(--green)";
}

function barColor(usePct: number | null, reqPct: number): string {
  if (usePct !== null) {
    if (usePct >= 90) return "var(--red)";
    if (usePct >= 70) return "var(--orange)";
    return "var(--green)";
  }
  if (reqPct >= 90) return "var(--red)";
  if (reqPct >= 70) return "var(--orange)";
  return "var(--accent)";
}

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

// SVG constants
const SIZE = 130;
const CX = SIZE / 2;
const ROUT = 50;
const RIN  = 33;
const COUT = 2 * Math.PI * ROUT;
const CIN  = 2 * Math.PI * RIN;

interface GaugeProps {
  label: string;
  allocatable: ResourceValue;
  requested: ResourceValue;
  limited: ResourceValue;
  usage?: ResourceValue;
  isCPU: boolean;
}

function CircleGauge({ label, allocatable, requested, limited, usage, isCPU }: GaugeProps) {
  const fmt = isCPU ? fmtCPU : fmtMemory;
  const allocPct = pct(requested, allocatable, isCPU);
  const usePct   = usage ? pct(usage, allocatable, isCPU) : null;
  const allocColor = gaugeColor(allocPct);
  const useColor   = usePct !== null ? gaugeColor(usePct) : "var(--border)";
  const mainPct    = usePct ?? allocPct;
  const mainColor  = usePct !== null ? useColor : allocColor;
  const overProv   = usePct !== null && allocPct > usePct + 15;

  const limVal   = isCPU ? (limited.millicores ?? 0) : (limited.bytes ?? 0);
  const allocVal = isCPU ? (allocatable.millicores ?? 0) : (allocatable.bytes ?? 0);
  const limPct   = allocVal > 0 ? Math.round((limVal / allocVal) * 100) : 0;
  const overcommit = limVal > allocVal;

  return (
    <div className={styles.gauge}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle cx={CX} cy={CX} r={ROUT} fill="none" stroke="var(--surface2)" strokeWidth={8} />
        {usePct !== null && (
          <circle
            cx={CX} cy={CX} r={ROUT}
            fill="none"
            stroke={useColor}
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={`${COUT} ${COUT}`}
            strokeDashoffset={COUT * (1 - usePct / 100)}
            transform={`rotate(-90 ${CX} ${CX})`}
            style={{ transition: "stroke-dashoffset 0.5s ease" }}
          />
        )}
        <circle cx={CX} cy={CX} r={RIN} fill="none" stroke="var(--surface2)" strokeWidth={6} />
        <circle
          cx={CX} cy={CX} r={RIN}
          fill="none"
          stroke={allocColor}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={`${CIN} ${CIN}`}
          strokeDashoffset={CIN * (1 - allocPct / 100)}
          transform={`rotate(-90 ${CX} ${CX})`}
          opacity={0.6}
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
        <text x={CX} y={CX - 7} textAnchor="middle" dominantBaseline="middle" fontSize={20} fontWeight={700} fill={mainColor} style={{ fontFamily: "inherit" }}>
          {mainPct}%
        </text>
        <text x={CX} y={CX + 13} textAnchor="middle" dominantBaseline="middle" fontSize={10} fontWeight={600} fill="var(--muted)" style={{ fontFamily: "inherit" }}>
          {usePct !== null ? "USAGE" : "ALLOC"}
        </text>
      </svg>

      <div className={styles.gaugeInfo}>
        <span className={styles.gaugeLabel}>{label}</span>
        <div className={styles.gaugeLine}>
          <span className={styles.gaugeDot} style={{ background: allocColor }} />
          <span>alloc <strong>{allocPct}%</strong> · {fmt(requested)}</span>
        </div>
        {usePct !== null ? (
          <div className={styles.gaugeLine}>
            <span className={styles.gaugeDot} style={{ background: useColor }} />
            <span>use <strong>{usePct}%</strong> · {fmt(usage!)}</span>
          </div>
        ) : (
          <span className={styles.gaugeNoData}>no metrics</span>
        )}
        <div className={styles.gaugeLine}>
          <span className={styles.gaugeDot} style={{ background: overcommit ? "var(--red)" : "var(--muted)", opacity: 0.5 }} />
          <span style={{ color: overcommit ? "var(--red)" : "var(--muted)" }}>
            lim <strong>{limPct}%</strong> · {fmt(limited)}
            {overcommit && <span className={styles.overcommitBadge}>OVERCOMMIT</span>}
          </span>
        </div>
        <span className={styles.gaugeAllocatable}>{fmt(allocatable)} allocatable</span>
        {overProv && (
          <span className={styles.gaugeGap}>▼ {allocPct - usePct!}pp gap</span>
        )}
      </div>
    </div>
  );
}

// --- Pod horizontal bar ---

interface PodBarProps {
  pod: PodDetail;
  allocCPU: number;
  allocMem: number;
}

function PodBar({ pod, allocCPU, allocMem }: PodBarProps) {
  let cpuReq = 0, cpuUse = 0, memReq = 0, memUse = 0;
  let hasUsage = false;
  for (const c of pod.containers) {
    cpuReq += c.requests.cpu.millicores ?? 0;
    memReq += c.requests.memory.bytes ?? 0;
    if (c.usage) {
      hasUsage = true;
      cpuUse += c.usage.cpu.millicores ?? 0;
      memUse += c.usage.memory.bytes ?? 0;
    }
  }

  const cpuReqPct = allocCPU > 0 ? Math.min(100, (cpuReq / allocCPU) * 100) : 0;
  const cpuUsePct = hasUsage && allocCPU > 0 ? Math.min(100, (cpuUse / allocCPU) * 100) : null;
  const memReqPct = allocMem > 0 ? Math.min(100, (memReq / allocMem) * 100) : 0;
  const memUsePct = hasUsage && allocMem > 0 ? Math.min(100, (memUse / allocMem) * 100) : null;

  const cpuColor = barColor(cpuUsePct, cpuReqPct);
  const memColor = barColor(memUsePct, memReqPct);

  // Shorten pod name: strip last two random suffixes
  const parts = pod.name.split("-");
  const shortName = parts.length > 3 ? parts.slice(0, -2).join("-") : pod.name;

  const cpuTooltip = cpuUsePct !== null
    ? `req: ${fmtCPU({ raw: "", millicores: cpuReq })} (${cpuReqPct.toFixed(0)}%) · use: ${fmtCPU({ raw: "", millicores: cpuUse })} (${cpuUsePct.toFixed(0)}%)`
    : `req: ${fmtCPU({ raw: "", millicores: cpuReq })} (${cpuReqPct.toFixed(0)}%) · no usage data`;
  const memTooltip = memUsePct !== null
    ? `req: ${fmtMemory({ raw: "", bytes: memReq })} (${memReqPct.toFixed(0)}%) · use: ${fmtMemory({ raw: "", bytes: memUse })} (${memUsePct.toFixed(0)}%)`
    : `req: ${fmtMemory({ raw: "", bytes: memReq })} (${memReqPct.toFixed(0)}%) · no usage data`;

  return (
    <div className={styles.podBar} title={pod.namespace ? `${pod.namespace}/${pod.name}` : pod.name}>
      <span className={styles.podBarName}>{shortName}</span>
      <div className={styles.podBarBars}>
        {/* CPU */}
        <div className={styles.podBarRow}>
          <span className={styles.podBarLabel}>CPU</span>
          <div className={styles.podBarTrack} title={cpuTooltip}>
            <div className={styles.podBarFill} style={{ width: `${cpuReqPct.toFixed(1)}%`, background: cpuColor + "55" }} />
            {cpuUsePct !== null && (
              <div className={styles.podBarUseFill} style={{ width: `${cpuUsePct.toFixed(1)}%`, background: cpuColor }} />
            )}
          </div>
          <span className={styles.podBarPct} style={{ color: cpuUsePct !== null ? cpuColor : "var(--muted)" }}>
            {cpuUsePct !== null ? `${cpuUsePct.toFixed(0)}%` : `${cpuReqPct.toFixed(0)}%`}
          </span>
        </div>
        {/* MEM */}
        <div className={styles.podBarRow}>
          <span className={styles.podBarLabel}>MEM</span>
          <div className={styles.podBarTrack} title={memTooltip}>
            <div className={styles.podBarFill} style={{ width: `${memReqPct.toFixed(1)}%`, background: memColor + "55" }} />
            {memUsePct !== null && (
              <div className={styles.podBarUseFill} style={{ width: `${memUsePct.toFixed(1)}%`, background: memColor }} />
            )}
          </div>
          <span className={styles.podBarPct} style={{ color: memUsePct !== null ? memColor : "var(--muted)" }}>
            {memUsePct !== null ? `${memUsePct.toFixed(0)}%` : `${memReqPct.toFixed(0)}%`}
          </span>
        </div>
      </div>
    </div>
  );
}

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
      {/* Header */}
      <div className={styles.header}>
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
        {node.diskPressure && <span className={styles.pressureBadge} title="DiskPressure condition is True">💾 DiskPressure</span>}
        {node.memoryPressure && <span className={styles.pressureBadge} title="MemoryPressure condition is True">⚠ MemPressure</span>}
        {node.pidPressure && <span className={styles.pressureBadge} title="PIDPressure condition is True">⚠ PIDPressure</span>}
        <span className={styles.pods} title="Running pods / max">
          {node.podCount} / {node.maxPods} pods
        </span>
      </div>
      {/* Node info line */}
      {(node.kubeletVersion || node.age) && (
        <div className={styles.nodeInfo}>
          {node.age && <span title="Node age">⏱ {node.age}</span>}
          {node.kubeletVersion && <span title="Kubelet version">kubelet {node.kubeletVersion}</span>}
          {node.kernelVersion && <span title="Kernel version">kernel {node.kernelVersion}</span>}
          {node.osImage && <span title="OS image" className={styles.nodeInfoOs}>{node.osImage}</span>}
        </div>
      )}

      {/* Taints */}
      {(node.taints?.length ?? 0) > 0 && (
        <div className={styles.taints}>
          {node.taints!.map((t, i) => {
            const taintLabel = t.value ? `${t.key}=${t.value}` : t.key;
            const shortKey = t.key.includes("/") ? t.key.split("/").pop()! : t.key;
            return (
              <span
                key={i}
                className={styles.taintBadge}
                style={{
                  background: TAINT_EFFECT_COLOR[t.effect] ?? "var(--surface2)",
                  borderColor: TAINT_EFFECT_BORDER[t.effect] ?? "var(--border)",
                }}
                title={`${taintLabel} · ${t.effect}`}
              >
                ⚠ {shortKey}{t.value ? `=${t.value}` : ""} · {t.effect}
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
