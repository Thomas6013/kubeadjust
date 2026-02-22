"use client";

import type { NodeOverview, ResourceValue } from "@/lib/api";
import { fmtCPU, fmtMemory } from "@/lib/api";
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

// SVG constants
const SIZE = 130;
const CX = SIZE / 2;
const ROUT = 50; // outer ring: usage
const RIN  = 33; // inner ring: allocated
const COUT = 2 * Math.PI * ROUT;
const CIN  = 2 * Math.PI * RIN;

interface GaugeProps {
  label: string;
  allocatable: ResourceValue;
  requested: ResourceValue;
  usage?: ResourceValue;
  isCPU: boolean;
}

function CircleGauge({ label, allocatable, requested, usage, isCPU }: GaugeProps) {
  const fmt = isCPU ? fmtCPU : fmtMemory;
  const allocPct = pct(requested, allocatable, isCPU);
  const usePct   = usage ? pct(usage, allocatable, isCPU) : null;
  const allocColor = gaugeColor(allocPct);
  const useColor   = usePct !== null ? gaugeColor(usePct) : "var(--border)";
  const mainPct    = usePct ?? allocPct;
  const mainColor  = usePct !== null ? useColor : allocColor;
  const overProv   = usePct !== null && allocPct > usePct + 15;

  return (
    <div className={styles.gauge}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        {/* Outer track */}
        <circle cx={CX} cy={CX} r={ROUT} fill="none" stroke="var(--surface2)" strokeWidth={8} />
        {/* Outer arc: usage */}
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
        {/* Inner track */}
        <circle cx={CX} cy={CX} r={RIN} fill="none" stroke="var(--surface2)" strokeWidth={6} />
        {/* Inner arc: allocated */}
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
        {/* Center: percentage */}
        <text
          x={CX} y={CX - 7}
          textAnchor="middle" dominantBaseline="middle"
          fontSize={20} fontWeight={700}
          fill={mainColor}
          style={{ fontFamily: "inherit" }}
        >
          {mainPct}%
        </text>
        {/* Center: sub-label */}
        <text
          x={CX} y={CX + 13}
          textAnchor="middle" dominantBaseline="middle"
          fontSize={10} fontWeight={600}
          fill="var(--muted)"
          style={{ fontFamily: "inherit" }}
        >
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
        <span className={styles.gaugeAllocatable}>{fmt(allocatable)} allocatable</span>
        {overProv && (
          <span className={styles.gaugeGap}>▼ {allocPct - usePct!}pp gap</span>
        )}
      </div>
    </div>
  );
}

// --- Main card ---

export default function NodeCard({ node }: { node: NodeOverview }) {
  const isReady = node.status === "Ready";
  const statusColor = isReady ? "var(--green)" : node.status === "NotReady" ? "var(--red)" : "var(--yellow)";
  const isControlPlane = node.roles.includes("control-plane");

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
        <span className={styles.pods} title="Running pods / max">
          {node.podCount} / {node.maxPods} pods
        </span>
      </div>

      {/* Resources */}
      {isReady ? (
        <div className={styles.resources}>
          <CircleGauge
            label="CPU"
            allocatable={node.allocatable.cpu}
            requested={node.requested.cpu}
            usage={node.usage?.cpu}
            isCPU={true}
          />
          <CircleGauge
            label="Memory"
            allocatable={node.allocatable.memory}
            requested={node.requested.memory}
            usage={node.usage?.memory}
            isCPU={false}
          />
        </div>
      ) : (
        <div className={styles.notReadyMsg}>Node is not ready — no resource data available</div>
      )}
    </div>
  );
}
