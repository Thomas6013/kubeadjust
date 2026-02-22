"use client";

import { useState, useEffect } from "react";
import type { PodDetail, HistoryResponse, EphemeralStorageInfo, ResourceValue } from "@/lib/api";
import { api, fmtStorage, storagePct } from "@/lib/api";
import { resourceStatus, storageStatus } from "@/lib/suggestions";
import ResourceBar from "./ResourceBar";
import VolumeSection from "./VolumeSection";
import Sparkline from "./Sparkline";
import styles from "./PodRow.module.css";

const STATUS_COLOR: Record<string, string> = {
  danger:   "var(--red)",
  warning:  "var(--orange)",
  overkill: "var(--blue-over)",
  healthy:  "var(--green)",
  none:     "var(--muted)",
};

interface PodRowProps {
  pod: PodDetail;
  namespace: string;
  prometheusAvailable: boolean;
  token: string;
}

export default function PodRow({ pod, namespace, prometheusAvailable, token }: PodRowProps) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<Record<string, HistoryResponse>>({});

  useEffect(() => {
    if (!open || !prometheusAvailable) return;
    for (const c of pod.containers) {
      if (history[c.name]) continue;
      api.containerHistory(token, namespace, pod.name, c.name)
        .then((h) => setHistory((prev) => ({ ...prev, [c.name]: h })))
        .catch(() => { /* best-effort */ });
    }
  }, [open, prometheusAvailable, pod, namespace, token, history]);

  const phaseColor =
    pod.phase === "Running"  ? "var(--green)"
    : pod.phase === "Pending" ? "var(--yellow)"
    : "var(--red)";

  return (
    <div className={styles.pod}>
      <button
        className={styles.header}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={styles.arrow}>{open ? "▾" : "▸"}</span>
        <span className={styles.name}>{pod.name}</span>
        <span className={styles.phase} style={{ color: phaseColor }}>{pod.phase}</span>
        <span className={styles.containers}>
          {pod.containers.length} container{pod.containers.length !== 1 ? "s" : ""}
        </span>
      </button>

      {open && (
        <div className={styles.body}>
          {pod.containers.map((c) => {
            const hist = history[c.name];
            const cpuStatus = resourceStatus(c.usage?.cpu, c.requests.cpu, c.limits.cpu, true);
            const memStatus = resourceStatus(c.usage?.memory, c.requests.memory, c.limits.memory, false);
            return (
              <div key={c.name} className={styles.container}>
                <div className={styles.containerName}>{c.name}</div>

                <div className={styles.resources}>
                  <div className={styles.resourceRow}>
                    <ResourceBar label="CPU" request={c.requests.cpu} limit={c.limits.cpu} usage={c.usage?.cpu} isCPU={true} />
                    {hist && hist.cpu.length >= 2 && (
                      <Sparkline points={hist.cpu.map((p) => p.v)} color={STATUS_COLOR[cpuStatus]} />
                    )}
                  </div>
                  <div className={styles.resourceRow}>
                    <ResourceBar label="Memory" request={c.requests.memory} limit={c.limits.memory} usage={c.usage?.memory} isCPU={false} />
                    {hist && hist.memory.length >= 2 && (
                      <Sparkline points={hist.memory.map((p) => p.v)} color={STATUS_COLOR[memStatus]} />
                    )}
                  </div>
                </div>

                {c.ephemeralStorage && <EphemeralBar eph={c.ephemeralStorage} />}
              </div>
            );
          })}

          <VolumeSection volumes={pod.volumes ?? []} />
        </div>
      )}
    </div>
  );
}

// --- Inline ephemeral storage row ---

function EphemeralBar({ eph }: { eph: EphemeralStorageInfo }) {
  const hasLimit = !!eph.limit;
  const capacity: ResourceValue | undefined = eph.limit;
  const status = storageStatus(eph.usage, capacity, hasLimit);
  const color = STATUS_COLOR[status] ?? "var(--border)";
  const pct = storagePct(eph.usage, capacity);

  return (
    <div className={styles.ephemeral}>
      <div className={styles.ephHeader}>
        <span className={styles.ephLabel}>Ephemeral storage</span>
        {!hasLimit && eph.usage && (
          <span style={{ fontSize: 10, color: "var(--orange)", fontWeight: 700, textTransform: "uppercase" }}>
            NO LIMIT
          </span>
        )}
        {pct !== null && (
          <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color }}>{pct}%</span>
        )}
      </div>
      <div className={styles.ephTrack}>
        <div className={styles.ephFill} style={{ width: pct !== null ? `${pct}%` : "0%", background: color }} />
      </div>
      <div className={styles.ephValues}>
        {eph.request && (
          <span className={styles.val}><span className={styles.valLabel}>req</span><strong>{fmtStorage(eph.request)}</strong></span>
        )}
        {eph.usage && (
          <span className={styles.val} style={{ color }}><span className={styles.valLabel}>use</span><strong>{fmtStorage(eph.usage)}</strong></span>
        )}
        {eph.limit && (
          <span className={styles.val}><span className={styles.valLabel}>lim</span><strong>{fmtStorage(eph.limit)}</strong></span>
        )}
        {!hasLimit && !eph.usage && (
          <span className={styles.val}><span className={styles.valLabel}>lim</span><strong style={{ color: "var(--muted)" }}>—</strong></span>
        )}
      </div>
    </div>
  );
}
