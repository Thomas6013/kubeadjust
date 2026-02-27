"use client";

import type { DeploymentDetail, TimeRange } from "@/lib/api";
import PodRow from "./PodRow";
import styles from "./DeploymentCard.module.css";

interface DeploymentCardProps {
  dep: DeploymentDetail;
  namespace: string;
  prometheusAvailable: boolean;
  token: string;
  timeRange?: TimeRange;
  openCards?: Set<string>;
  onToggleCard?: (id: string) => void;
}

export default function DeploymentCard({ dep, namespace, prometheusAvailable, token, timeRange, openCards, onToggleCard }: DeploymentCardProps) {
  const cardId = `dep:${dep.name}`;
  const open = openCards?.has(cardId) ?? false;

  const healthy = dep.readyReplicas === dep.replicas;
  const statusColor = healthy ? "var(--green)" : "var(--yellow)";

  return (
    <div id={`dep-${dep.name}`} className={styles.card}>
      <button className={styles.header} onClick={() => onToggleCard?.(cardId)} aria-expanded={open}>
        <span className={styles.arrow}>{open ? "▾" : "▸"}</span>
        <span className={styles.name}>{dep.name}</span>
        {dep.kind && dep.kind !== "Deployment" && (
          <span className={styles.kindBadge}>{dep.kind}</span>
        )}
        <span className={styles.replicas} style={{ color: statusColor }}>
          {dep.readyReplicas}/{dep.replicas} ready
        </span>
        <span className={styles.pods}>
          {(dep.pods ?? []).length} pod{(dep.pods ?? []).length !== 1 ? "s" : ""}
        </span>
      </button>

      {open && (
        <div className={styles.body}>
          {!dep.pods || dep.pods.length === 0 ? (
            <p className={styles.empty}>No pods found.</p>
          ) : (
            dep.pods.map((pod) => (
              <PodRow
                key={pod.name}
                pod={pod}
                namespace={namespace}
                prometheusAvailable={prometheusAvailable}
                token={token}
                timeRange={timeRange}
                openCards={openCards}
                onToggleCard={onToggleCard}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
