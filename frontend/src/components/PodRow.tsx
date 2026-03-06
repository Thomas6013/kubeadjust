"use client";

import { useState, useEffect, useRef } from "react";
import type { PodDetail, HistoryResponse, EphemeralStorageInfo, ResourceValue, TimeRange, DataPoint } from "@/lib/api";
import { api, fmtStorage, storagePct } from "@/lib/api";
import { resourceStatus, storageStatus } from "@/lib/suggestions";
import ResourceBar from "./ResourceBar";
import VolumeSection from "./VolumeSection";
import Sparkline from "./Sparkline";
import SparklineModal from "./SparklineModal";
import styles from "./PodRow.module.css";

function shortPodName(name: string): string {
  const parts = name.split("-");
  return parts.length > 3 ? parts.slice(0, -2).join("-") : name;
}

const STATUS_COLOR: Record<string, string> = {
  danger:   "var(--red)",
  warning:  "var(--orange)",
  overkill: "var(--blue-over)",
  healthy:  "var(--green)",
  none:     "var(--muted)",
};

interface ZoomedChart {
  dataPoints: DataPoint[];
  label: string;
  color: string;
  isCPU: boolean;
  title: string;
}

interface PodRowProps {
  pod: PodDetail;
  namespace: string;
  prometheusAvailable: boolean;
  token: string;
  timeRange?: TimeRange;
  openCards?: Set<string>;
  onToggleCard?: (id: string) => void;
  deploymentName?: string;
  onFilterByPod?: (podName: string | null) => void;
  activePodFilter?: string | null;
}

export default function PodRow({
  pod, namespace, prometheusAvailable, token, timeRange = "1h",
  openCards, onToggleCard, deploymentName, onFilterByPod, activePodFilter,
}: PodRowProps) {
  const podId = `pod:${pod.name}`;
  const open = openCards?.has(podId) ?? false;
  const [history, setHistory] = useState<Record<string, HistoryResponse>>({});
  const fetchedRef = useRef<Set<string>>(new Set());
  const generationRef = useRef(0);
  const [zoomed, setZoomed] = useState<ZoomedChart | null>(null);

  // Invalidate cache when time range changes — bump generation so in-flight fetches are discarded
  useEffect(() => {
    generationRef.current += 1;
    fetchedRef.current.clear();
    setHistory({});
  }, [timeRange]);

  useEffect(() => {
    if (!open || !prometheusAvailable) return;
    const gen = generationRef.current;
    for (const c of pod.containers) {
      if (fetchedRef.current.has(c.name)) continue;
      fetchedRef.current.add(c.name);
      api.containerHistory(token, namespace, pod.name, c.name, timeRange)
        .then((h) => {
          if (generationRef.current !== gen) return; // stale — discard
          setHistory((prev) => ({ ...prev, [c.name]: h }));
        })
        .catch(() => { fetchedRef.current.delete(c.name); });
    }
  }, [open, prometheusAvailable, pod, namespace, token, timeRange]);

  const phaseColor =
    pod.phase === "Running"  ? "var(--green)"
    : pod.phase === "Pending" ? "var(--yellow)"
    : "var(--red)";

  const isFiltered = activePodFilter === pod.name;

  return (
    <div
      id={deploymentName ? `pod-row-${deploymentName}-${pod.name}` : undefined}
      className={styles.pod}
    >
      <div className={styles.header}>
        <button
          className={styles.toggleBtn}
          onClick={() => onToggleCard?.(podId)}
          aria-expanded={open}
        >
          <span className={styles.arrow}>{open ? "▾" : "▸"}</span>
          <span className={styles.name}>{pod.name}</span>
          <span className={styles.phase} style={{ color: phaseColor }}>{pod.phase}</span>
          <span className={styles.containers}>
            {pod.containers.length} container{pod.containers.length !== 1 ? "s" : ""}
          </span>
        </button>
        {onFilterByPod && (
          <button
            type="button"
            className={`${styles.filterBtn} ${isFiltered ? styles.filterBtnActive : ""}`}
            title={isFiltered ? "Clear pod filter" : "Show only this pod's suggestions"}
            onClick={() => onFilterByPod(isFiltered ? null : pod.name)}
          >
            {isFiltered ? "⊗" : "⊕"}
          </button>
        )}
      </div>

      {open && (
        <div className={styles.body}>
          {pod.containers.map((c) => {
            const hist = history[c.name];
            const cpuStatus = resourceStatus(c.usage?.cpu, c.requests.cpu, c.limits.cpu, true);
            const memStatus = resourceStatus(c.usage?.memory, c.requests.memory, c.limits.memory, false);
            const containerId = deploymentName ? `container-${deploymentName}-${pod.name}-${c.name}` : undefined;
            return (
              <div key={c.name} id={containerId} className={styles.container}>
                <div className={styles.containerName}>{c.name}</div>

                <div className={styles.resources}>
                  <div className={styles.resourceRow}>
                    <ResourceBar label="CPU" request={c.requests.cpu} limit={c.limits.cpu} usage={c.usage?.cpu} isCPU={true} />
                    {hist && hist.cpu.length >= 2 && (
                      <Sparkline
                        points={hist.cpu.map((p) => p.v)}
                        color={STATUS_COLOR[cpuStatus]}
                        onClick={() => setZoomed({
                          dataPoints: hist.cpu,
                          label: "CPU",
                          color: STATUS_COLOR[cpuStatus],
                          isCPU: true,
                          title: `${shortPodName(pod.name)} / ${c.name}`,
                        })}
                      />
                    )}
                  </div>
                  <div className={styles.resourceRow}>
                    <ResourceBar label="Memory" request={c.requests.memory} limit={c.limits.memory} usage={c.usage?.memory} isCPU={false} />
                    {hist && hist.memory.length >= 2 && (
                      <Sparkline
                        points={hist.memory.map((p) => p.v)}
                        color={STATUS_COLOR[memStatus]}
                        onClick={() => setZoomed({
                          dataPoints: hist.memory,
                          label: "Memory",
                          color: STATUS_COLOR[memStatus],
                          isCPU: false,
                          title: `${shortPodName(pod.name)} / ${c.name}`,
                        })}
                      />
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

      {zoomed && (
        <SparklineModal
          isOpen={true}
          onClose={() => setZoomed(null)}
          dataPoints={zoomed.dataPoints}
          label={zoomed.label}
          color={zoomed.color}
          isCPU={zoomed.isCPU}
          title={zoomed.title}
        />
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
