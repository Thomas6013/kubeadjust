"use client";

import type { VolumeDetail } from "@/lib/api";
import { fmtStorage, storagePct } from "@/lib/api";
import { storageStatus } from "@/lib/suggestions";
import styles from "./VolumeSection.module.css";

const STATUS_COLOR: Record<string, string> = {
  danger:  "var(--red)",
  warning: "var(--orange)",
  healthy: "var(--green)",
  none:    "var(--border)",
};

function VolumeBar({ vol }: { vol: VolumeDetail }) {
  const isPVC = vol.type === "pvc";
  const capacity = isPVC ? vol.capacity : vol.sizeLimit;
  const hasLimit = !!capacity;
  const status = storageStatus(vol.usage, capacity, hasLimit);
  const color = STATUS_COLOR[status] ?? "var(--border)";
  const pct = storagePct(vol.usage, capacity);

  return (
    <div className={styles.volume}>
      <div className={styles.volHeader}>
        <span className={styles.volType} style={{ background: isPVC ? "rgba(108,142,247,0.15)" : "rgba(99,179,237,0.12)", color: isPVC ? "var(--accent)" : "var(--blue-over)" }}>
          {isPVC ? "PVC" : vol.medium === "Memory" ? "tmpfs" : "emptyDir"}
        </span>
        <span className={styles.volName}>{vol.name}</span>
        {isPVC && vol.pvcName && vol.pvcName !== vol.name && (
          <span className={styles.claimName}>{vol.pvcName}</span>
        )}
        {isPVC && vol.storageClass && (
          <span className={styles.storageClass}>{vol.storageClass}</span>
        )}
        {isPVC && vol.accessModes && (
          <span className={styles.accessMode}>{vol.accessModes[0]}</span>
        )}
        {!hasLimit && vol.usage && (
          <span className={styles.noLimit} style={{ color: "var(--orange)" }}>no limit</span>
        )}
        {pct !== null && (
          <span className={styles.pct} style={{ color, marginLeft: "auto" }}>{pct}%</span>
        )}
      </div>

      {/* Bar */}
      <div className={styles.track}>
        <div
          className={styles.fill}
          style={{
            width: pct !== null ? `${pct}%` : "0%",
            background: pct !== null ? color : "transparent",
          }}
        />
      </div>

      {/* Values */}
      <div className={styles.values}>
        {vol.usage && (
          <span className={styles.val} style={{ color }}>
            <span className={styles.valLabel}>used</span>
            <strong>{fmtStorage(vol.usage)}</strong>
          </span>
        )}
        {vol.available && (
          <span className={styles.val}>
            <span className={styles.valLabel}>free</span>
            <strong>{fmtStorage(vol.available)}</strong>
          </span>
        )}
        {capacity && (
          <span className={styles.val}>
            <span className={styles.valLabel}>{isPVC ? "capacity" : "limit"}</span>
            <strong>{fmtStorage(capacity)}</strong>
          </span>
        )}
        {!hasLimit && vol.usage && (
          <span className={styles.val}>
            <span className={styles.valLabel}>usage</span>
            <strong style={{ color: "var(--orange)" }}>{fmtStorage(vol.usage)} (unbounded)</strong>
          </span>
        )}
      </div>
    </div>
  );
}

export default function VolumeSection({ volumes }: { volumes: VolumeDetail[] }) {
  if (!volumes || volumes.length === 0) return null;
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Volumes</div>
      <div className={styles.list}>
        {volumes.map((vol) => (
          <VolumeBar key={vol.name} vol={vol} />
        ))}
      </div>
    </div>
  );
}
