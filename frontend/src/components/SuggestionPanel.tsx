"use client";

import type { DeploymentDetail } from "@/lib/api";
import { computeSuggestions, type Suggestion, type SuggestionKind } from "@/lib/suggestions";
import styles from "./SuggestionPanel.module.css";

const KIND_META: Record<SuggestionKind, { icon: string; color: string; action: string }> = {
  danger:  { icon: "▲", color: "var(--red)",       action: "Increase limit" },
  warning: { icon: "●", color: "var(--orange)",    action: "Increase limit" },
  overkill:{ icon: "▼", color: "var(--blue-over)", action: "Reduce request" },
};

const RESOURCE_ORDER = ["CPU", "Memory", "Ephemeral — no limit", "Ephemeral", "PVC", "EmptyDir"];
const KIND_ORDER: Record<SuggestionKind, number> = { danger: 0, warning: 1, overkill: 2 };

function groupSuggestions(suggestions: Suggestion[]): Array<{ resource: string; items: Suggestion[] }> {
  const map = new Map<string, Suggestion[]>();
  for (const s of suggestions) {
    if (!map.has(s.resource)) map.set(s.resource, []);
    map.get(s.resource)!.push(s);
  }
  // Sort within each group by severity
  for (const items of map.values()) {
    items.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  }
  const groups: Array<{ resource: string; items: Suggestion[] }> = [];
  for (const resource of RESOURCE_ORDER) {
    if (map.has(resource)) {
      groups.push({ resource, items: map.get(resource)! });
      map.delete(resource);
    }
  }
  // Any remaining resources not in the predefined order
  for (const [resource, items] of map) {
    groups.push({ resource, items });
  }
  return groups;
}

function SuggestionItem({ s }: { s: Suggestion }) {
  const meta = KIND_META[s.kind];
  return (
    <a href={`#dep-${s.deployment}`} className={styles.item} style={{ borderLeftColor: meta.color }}>
      <div className={styles.itemHeader}>
        <span className={styles.icon} style={{ color: meta.color }}>{meta.icon}</span>
        <span className={styles.depName}>{s.deployment}</span>
      </div>
      <p className={styles.itemMsg}>{s.message}</p>
      <div className={styles.itemAction}>
        <span className={styles.actionLabel}>{meta.action}</span>
        <span className={styles.arrow}>→</span>
        <span className={styles.current}>{s.current}</span>
        <span className={styles.arrow}>→</span>
        <span className={styles.suggested} style={{ color: meta.color }}>{s.suggested}</span>
      </div>
      <div className={styles.containerTag}>{s.container}</div>
    </a>
  );
}

export default function SuggestionPanel({ deployments }: { deployments: DeploymentDetail[] }) {
  const suggestions = computeSuggestions(deployments);
  const groups = groupSuggestions(suggestions);

  const danger  = suggestions.filter((s) => s.kind === "danger").length;
  const warning = suggestions.filter((s) => s.kind === "warning").length;
  const overkill= suggestions.filter((s) => s.kind === "overkill").length;

  return (
    <aside className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Suggestions</span>
        <span className={styles.total}>{suggestions.length}</span>
      </div>

      {suggestions.length === 0 ? (
        <div className={styles.allGood}>
          <span className={styles.allGoodIcon}>✓</span>
          <p>All resources look healthy</p>
        </div>
      ) : (
        <>
          {/* Summary chips */}
          <div className={styles.summary}>
            {danger > 0 && (
              <span className={styles.chip} style={{ background: "rgba(252,129,129,0.15)", color: "var(--red)" }}>
                ▲ {danger} critical
              </span>
            )}
            {warning > 0 && (
              <span className={styles.chip} style={{ background: "rgba(246,166,35,0.15)", color: "var(--orange)" }}>
                ● {warning} warning
              </span>
            )}
            {overkill > 0 && (
              <span className={styles.chip} style={{ background: "rgba(99,179,237,0.15)", color: "var(--blue-over)" }}>
                ▼ {overkill} over-prov
              </span>
            )}
          </div>

          <div className={styles.list}>
            {groups.map(({ resource, items }) => (
              <div key={resource} className={styles.group}>
                <div className={styles.groupHeader}>
                  <span>{resource}</span>
                  <span className={styles.groupCount}>{items.length}</span>
                </div>
                {items.map((s, i) => (
                  <SuggestionItem key={i} s={s} />
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
