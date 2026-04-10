"use client";

import { useState } from "react";
import type { NamespaceItem, NodeOverview } from "@/lib/api";
import type { View } from "@/hooks/useSessionState";
import styles from "@/app/dashboard/dashboard.module.css";

interface SidebarProps {
  view: View;
  setView: (v: View) => void;
  selectedNs: string;
  setSelectedNs: (ns: string) => void;
  nodes: NodeOverview[];
  namespaces: NamespaceItem[];
  loadingNs: boolean;
  excludedNs: Set<string>;
  onHideNamespace: (name: string) => void;
  onRestoreNamespace: (name: string) => void;
}

export default function Sidebar({
  view, setView, selectedNs, setSelectedNs, nodes,
  namespaces, loadingNs, excludedNs,
  onHideNamespace, onRestoreNamespace,
}: SidebarProps) {
  const [nsSearch, setNsSearch] = useState("");

  const visibleNamespaces = namespaces
    .filter((ns) => !excludedNs.has(ns.name))
    .filter((ns) => ns.name.toLowerCase().includes(nsSearch.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const hiddenNamespaces = namespaces
    .filter((ns) => excludedNs.has(ns.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <aside className={styles.sidebar}>
      {/* Cluster section */}
      <p className={styles.sidebarTitle}>Cluster</p>
      <ul className={styles.nsList}>
        <li>
          <button
            className={`${styles.nsBtn} ${styles.nodeBtn} ${view === "overview" ? styles.active : ""}`}
            onClick={() => setView("overview")}
          >
            ⊞ Overview
          </button>
        </li>
        <li>
          <button
            className={`${styles.nsBtn} ${styles.nodeBtn} ${view === "nodes" ? styles.active : ""}`}
            onClick={() => setView("nodes")}
          >
            ⬡ Nodes
            {nodes.length > 0 && (
              <span className={styles.nodeBadge}>
                {nodes.filter((n) => n.status === "Ready").length}/{nodes.length}
              </span>
            )}
          </button>
        </li>
      </ul>

      {/* Namespaces section */}
      <p className={styles.sidebarTitle} style={{ marginTop: 20 }}>Namespaces</p>
      {loadingNs ? (
        <p className={styles.muted}>Loading…</p>
      ) : (
        <>
          <input
            className={styles.nsSearch}
            type="text"
            placeholder="Search namespaces…"
            value={nsSearch}
            onChange={(e) => setNsSearch(e.target.value)}
          />
          <ul className={styles.nsList}>
            {visibleNamespaces.map((ns) => (
              <li key={ns.name} className={styles.nsRow}>
                <button
                  className={`${styles.nsBtn} ${view === "namespaces" && selectedNs === ns.name ? styles.active : ""}`}
                  onClick={() => { setView("namespaces"); setSelectedNs(ns.name); }}
                >
                  <span className={styles.nsBtnName}>{ns.name}</span>
                </button>
                <button
                  className={styles.nsHide}
                  onClick={(e) => { e.stopPropagation(); onHideNamespace(ns.name); }}
                  title={`Hide ${ns.name}`}
                >✕</button>
              </li>
            ))}
          </ul>
          {hiddenNamespaces.length > 0 && (
            <details className={styles.hiddenSection}>
              <summary className={styles.hiddenSummary}>
                {hiddenNamespaces.length} hidden
              </summary>
              <ul className={styles.nsList}>
                {hiddenNamespaces.map((ns) => (
                  <li key={ns.name} className={styles.nsRow}>
                    <span className={styles.hiddenName}>{ns.name}</span>
                    <button
                      className={styles.nsRestore}
                      onClick={() => onRestoreNamespace(ns.name)}
                      title={`Restore ${ns.name}`}
                    >+</button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </aside>
  );
}
