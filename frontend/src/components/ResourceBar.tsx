"use client";

import type { ResourceValue } from "@/lib/api";
import { fmtCPU, fmtMemory } from "@/lib/api";
import { resourceStatus } from "@/lib/suggestions";
import styles from "./ResourceBar.module.css";

interface Props {
  label: string;
  request: ResourceValue;
  limit: ResourceValue;
  usage?: ResourceValue;
  isCPU: boolean;
}

const STATUS_COLOR: Record<string, string> = {
  danger:  "var(--red)",
  warning: "var(--orange)",
  overkill:"var(--blue-over)",
  healthy: "var(--green)",
  none:    "var(--border)",
};

const STATUS_LABEL: Record<string, string> = {
  danger:  "CRITICAL",
  warning: "WARNING",
  overkill:"OVER-PROV",
  healthy: "",
  none:    "NO DATA",
};

export default function ResourceBar({ label, request, limit, usage, isCPU }: Props) {
  const fmt = isCPU ? fmtCPU : fmtMemory;
  const status = resourceStatus(usage, request, limit, isCPU);
  const color = STATUS_COLOR[status];

  const limitVal = isCPU ? (limit.millicores ?? 0) : (limit.bytes ?? 0);
  const useVal   = usage ? (isCPU ? (usage.millicores ?? 0) : (usage.bytes ?? 0)) : 0;
  const reqVal   = isCPU ? (request.millicores ?? 0) : (request.bytes ?? 0);

  const usePct = limitVal > 0 ? Math.min(100, (useVal / limitVal) * 100) : 0;
  const reqPct = limitVal > 0 ? Math.min(100, (reqVal / limitVal) * 100) : 0;

  return (
    <div className={styles.wrap}>
      {/* Header row */}
      <div className={styles.header}>
        <span className={styles.label}>{label}</span>
        {status !== "healthy" && status !== "none" && (
          <span className={styles.badge} style={{ color, borderColor: color }}>
            {STATUS_LABEL[status]}
          </span>
        )}
        {usage && limitVal > 0 && (
          <span className={styles.pct} style={{ color }}>
            {Math.round(usePct)}%
          </span>
        )}
      </div>

      {/* Bar */}
      <div className={styles.track}>
        {/* request marker */}
        {reqPct > 0 && (
          <div
            className={styles.reqMarker}
            style={{ left: `${reqPct}%` }}
            title={`Request: ${fmt(request)}`}
          />
        )}
        {/* usage fill */}
        {usage && (
          <div
            className={styles.fill}
            style={{ width: `${usePct}%`, background: color }}
          />
        )}
      </div>

      {/* Values row */}
      <div className={styles.values}>
        <span className={styles.val}>
          <span className={styles.valLabel}>req</span>
          <strong>{fmt(request) || "—"}</strong>
        </span>
        {usage && (
          <span className={styles.val} style={{ color }}>
            <span className={styles.valLabel}>use</span>
            <strong>{fmt(usage)}</strong>
          </span>
        )}
        <span className={styles.val}>
          <span className={styles.valLabel}>lim</span>
          <strong>{fmt(limit) || "—"}</strong>
        </span>
        {usage && limitVal > 0 && (
          <span className={styles.val} style={{ color: "var(--muted)" }}>
            <span className={styles.valLabel}>headroom</span>
            <strong>{fmt(isCPU
              ? { raw: `${Math.max(0, limitVal - useVal)}m`, millicores: Math.max(0, limitVal - useVal) }
              : { raw: `${Math.max(0, limitVal - useVal)}`, bytes: Math.max(0, limitVal - useVal) }
            )}</strong>
          </span>
        )}
      </div>
    </div>
  );
}
