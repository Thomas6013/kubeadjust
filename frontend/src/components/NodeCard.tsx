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

function barColor(p: number): string {
  if (p >= 90) return "var(--red)";
  if (p >= 70) return "var(--orange)";
  if (p <= 20) return "var(--blue-over)";
  return "var(--green)";
}

interface DualBarProps {
  label: string;
  allocatable: ResourceValue;
  requested: ResourceValue;
  usage?: ResourceValue;
  isCPU: boolean;
}

function DualBar({ label, allocatable, requested, usage, isCPU }: DualBarProps) {
  const fmt = isCPU ? fmtCPU : fmtMemory;
  const allocPct = pct(requested, allocatable, isCPU);
  const usePct = usage ? pct(usage, allocatable, isCPU) : null;
  const allocColor = barColor(allocPct);
  const useColor = usePct !== null ? barColor(usePct) : "var(--border)";

  return (
    <div className={styles.resource}>
      <div className={styles.resHeader}>
        <span className={styles.resLabel}>{label}</span>
        <span className={styles.resAllocatable}>{fmt(allocatable)} allocatable</span>
      </div>

      {/* Allocated bar */}
      <div className={styles.barRow}>
        <span className={styles.barRowLabel}>allocated</span>
        <div className={styles.track}>
          <div className={styles.fill} style={{ width: `${allocPct}%`, background: allocColor }} />
        </div>
        <span className={styles.barPct} style={{ color: allocColor }}>{allocPct}%</span>
        <span className={styles.barVal}>{fmt(requested)}</span>
      </div>

      {/* Usage bar */}
      <div className={styles.barRow}>
        <span className={styles.barRowLabel}>usage</span>
        <div className={styles.track}>
          {usePct !== null ? (
            <div className={styles.fill} style={{ width: `${usePct}%`, background: useColor }} />
          ) : (
            <div className={styles.noData}>no metrics</div>
          )}
        </div>
        {usePct !== null && (
          <>
            <span className={styles.barPct} style={{ color: useColor }}>{usePct}%</span>
            <span className={styles.barVal}>{usage ? fmt(usage) : "—"}</span>
          </>
        )}
      </div>

      {/* Gap indicator */}
      {usePct !== null && allocPct > usePct + 15 && (
        <div className={styles.gap} style={{ color: "var(--blue-over)" }}>
          ▼ {allocPct - usePct}pp gap — over-provisioned
        </div>
      )}
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
          <DualBar
            label="CPU"
            allocatable={node.allocatable.cpu}
            requested={node.requested.cpu}
            usage={node.usage?.cpu}
            isCPU={true}
          />
          <DualBar
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
