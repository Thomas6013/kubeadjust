"use client";

import { useState } from "react";
import type { DeploymentDetail } from "@/lib/api";
import PodRow from "./PodRow";
import styles from "./DeploymentCard.module.css";

interface DeploymentCardProps {
  dep: DeploymentDetail;
  namespace: string;
  prometheusAvailable: boolean;
  token: string;
}

export default function DeploymentCard({ dep, namespace, prometheusAvailable, token }: DeploymentCardProps) {
  const [open, setOpen] = useState(false);

  const healthy = dep.readyReplicas === dep.replicas;
  const statusColor = healthy ? "var(--green)" : "var(--yellow)";

  return (
    <div id={`dep-${dep.name}`} className={styles.card}>
      <button className={styles.header} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
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
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
