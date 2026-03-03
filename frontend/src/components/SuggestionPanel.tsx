"use client";

import { useState, useEffect } from "react";
import type { DeploymentDetail, ContainerHistory } from "@/lib/api";
import { computeSuggestions, type Suggestion, type SuggestionKind } from "@/lib/suggestions";
import styles from "./SuggestionPanel.module.css";

const ALL_KINDS: SuggestionKind[] = ["danger", "warning", "overkill"];

const KIND_META: Record<SuggestionKind, { icon: string; color: string; label: string; bg: string }> = {
  danger:   { icon: "▲", color: "var(--red)",       label: "critical",  bg: "rgba(252,129,129,0.15)" },
  warning:  { icon: "●", color: "var(--orange)",    label: "warning",   bg: "rgba(246,166,35,0.15)" },
  overkill: { icon: "▼", color: "var(--blue-over)", label: "over-prov", bg: "rgba(99,179,237,0.15)" },
};

const RESOURCE_ORDER = ["CPU", "Memory", "CPU — no limit", "Memory — no limit", "CPU — no request", "Memory — no request", "Ephemeral — no limit", "Ephemeral", "PVC", "EmptyDir"];
const KIND_ORDER: Record<SuggestionKind, number> = { danger: 0, warning: 1, overkill: 2 };

const STORAGE_KEY_EXCLUDED = "kubeadjust:excludedKinds";

function loadExcludedKinds(): Set<SuggestionKind> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_EXCLUDED);
    if (raw) return new Set(JSON.parse(raw) as SuggestionKind[]);
  } catch { /* ignore */ }
  return new Set();
}

function saveExcludedKinds(excluded: Set<SuggestionKind>) {
  sessionStorage.setItem(STORAGE_KEY_EXCLUDED, JSON.stringify([...excluded]));
}

function groupSuggestions(suggestions: Suggestion[]): Array<{ resource: string; items: Suggestion[] }> {
  const map = new Map<string, Suggestion[]>();
  for (const s of suggestions) {
    if (!map.has(s.resource)) map.set(s.resource, []);
    map.get(s.resource)!.push(s);
  }
  map.forEach((items) => {
    items.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  });
  const groups: Array<{ resource: string; items: Suggestion[] }> = [];
  for (const resource of RESOURCE_ORDER) {
    if (map.has(resource)) {
      groups.push({ resource, items: map.get(resource)! });
      map.delete(resource);
    }
  }
  map.forEach((items, resource) => {
    groups.push({ resource, items });
  });
  return groups;
}

function suggestionKey(s: Suggestion): string {
  return `${s.deployment}:${s.pod}:${s.container}:${s.resource}:${s.kind}`;
}

function SuggestionItem({ s, onOpenCards }: { s: Suggestion; onOpenCards?: (ids: string[]) => void }) {
  const meta = KIND_META[s.kind];
  const href = `#container-${s.deployment}-${s.pod}-${s.container}`;
  return (
    <a
      href={href}
      className={styles.item}
      style={{ borderLeftColor: meta.color }}
      onClick={() => onOpenCards?.([`dep:${s.deployment}`, `pod:${s.pod}`])}
    >
      <div className={styles.itemHeader}>
        <span className={styles.icon} style={{ color: meta.color }}>{meta.icon}</span>
        <span className={styles.depName}>{s.deployment}</span>
        <span className={styles.podTag}>{s.pod.split("-").slice(-2).join("-")}</span>
      </div>
      <p className={styles.itemMsg}>{s.message}</p>
      <div className={styles.itemAction}>
        <span className={styles.actionLabel}>{s.action}</span>
        <span className={styles.arrow}>→</span>
        <span className={styles.current}>{s.current}</span>
        <span className={styles.arrow}>→</span>
        <span className={styles.suggested} style={{ color: meta.color }}>{s.suggested}</span>
      </div>
      <div className={styles.containerTag}>{s.container}</div>
    </a>
  );
}

interface SuggestionGroupProps {
  resource: string;
  items: Suggestion[];
  open: boolean;
  onToggle: () => void;
  onOpenCards?: (ids: string[]) => void;
}

function SuggestionGroup({ resource, items, open, onToggle, onOpenCards }: SuggestionGroupProps) {
  return (
    <div className={styles.group}>
      <button className={styles.groupHeader} onClick={onToggle}>
        <span className={styles.groupArrow}>{open ? "▾" : "▸"}</span>
        <span className={styles.groupLabel}>{resource}</span>
        <span className={styles.groupCount}>{items.length}</span>
      </button>
      {open && items.map((s) => (
        <SuggestionItem key={suggestionKey(s)} s={s} onOpenCards={onOpenCards} />
      ))}
    </div>
  );
}

interface SuggestionPanelProps {
  deployments: DeploymentDetail[];
  history?: ContainerHistory[];
  onOpenCards?: (ids: string[]) => void;
  filterPod?: string | null;
  onClearPodFilter?: () => void;
}

export default function SuggestionPanel({ deployments, history, onOpenCards, filterPod, onClearPodFilter }: SuggestionPanelProps) {
  // --- Exclusion state (persisted) ---
  const [excludedKinds, setExcludedKinds] = useState<Set<SuggestionKind>>(new Set());
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    setExcludedKinds(loadExcludedKinds());
  }, []);

  function toggleExcluded(kind: SuggestionKind) {
    setExcludedKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind); else next.add(kind);
      saveExcludedKinds(next);
      return next;
    });
  }

  // --- Chip filter state (transient) ---
  const [activeKinds, setActiveKinds] = useState<Set<SuggestionKind>>(new Set());

  function toggleChip(kind: SuggestionKind) {
    setActiveKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind); else next.add(kind);
      return next;
    });
  }

  // --- Open/close state per group (lifted to survive re-renders) ---
  const [openGroups, setOpenGroups] = useState<Map<string, boolean>>(new Map());

  function isGroupOpen(resource: string): boolean {
    return openGroups.get(resource) ?? true;
  }

  function toggleGroup(resource: string) {
    setOpenGroups((prev) => {
      const next = new Map(prev);
      next.set(resource, !(prev.get(resource) ?? true));
      return next;
    });
  }

  // --- Compute suggestions ---
  const allSuggestions = computeSuggestions(deployments, history);
  // 1) Remove excluded kinds
  const suggestions = allSuggestions.filter((s) => !excludedKinds.has(s.kind));
  // 2) Apply pod filter
  const podFiltered = filterPod ? suggestions.filter((s) => s.pod === filterPod) : suggestions;
  // 3) Apply chip filter (if any active)
  const filtered = activeKinds.size > 0
    ? podFiltered.filter((s) => activeKinds.has(s.kind))
    : podFiltered;
  const groups = groupSuggestions(filtered);

  // Counts (after exclusion + pod filter, before chip filter)
  const counts: Record<SuggestionKind, number> = { danger: 0, warning: 0, overkill: 0 };
  for (const s of podFiltered) counts[s.kind]++;

  return (
    <aside className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Suggestions</span>
        <div className={styles.headerRight}>
          <button
            className={`${styles.filterBtn} ${excludedKinds.size > 0 ? styles.filterBtnActive : ""}`}
            onClick={() => setShowDropdown((o) => !o)}
            title="Filter suggestion types"
          >⚙</button>
          <span className={styles.total}>{podFiltered.length}</span>
        </div>
      </div>

      {filterPod && (
        <div className={styles.podFilter}>
          <span className={styles.podFilterLabel}>⊕ {filterPod}</span>
          <button className={styles.podFilterClear} onClick={onClearPodFilter} title="Show all pods">✕</button>
        </div>
      )}

      {showDropdown && (
        <div className={styles.dropdown}>
          {ALL_KINDS.map((kind) => (
            <label key={kind} className={styles.dropdownRow}>
              <input
                type="checkbox"
                checked={!excludedKinds.has(kind)}
                onChange={() => toggleExcluded(kind)}
                style={{ accentColor: KIND_META[kind].color }}
              />
              <span style={{ color: KIND_META[kind].color }}>{KIND_META[kind].icon}</span>
              <span>{KIND_META[kind].label}</span>
            </label>
          ))}
        </div>
      )}

      {podFiltered.length === 0 ? (
        <div className={styles.allGood}>
          <span className={styles.allGoodIcon}>✓</span>
          <p>{filterPod ? `No suggestions for ${filterPod}` : "All resources look healthy"}</p>
        </div>
      ) : (
        <>
          <div className={styles.summary}>
            {ALL_KINDS.map((kind) => {
              if (counts[kind] === 0) return null;
              const meta = KIND_META[kind];
              const isActive = activeKinds.has(kind);
              const isDimmed = activeKinds.size > 0 && !isActive;
              return (
                <span
                  key={kind}
                  className={`${styles.chip} ${isActive ? styles.chipActive : ""} ${isDimmed ? styles.chipDimmed : ""}`}
                  style={{ background: meta.bg, color: meta.color }}
                  onClick={() => toggleChip(kind)}
                >
                  {meta.icon} {counts[kind]} {meta.label}
                </span>
              );
            })}
          </div>

          <div className={styles.list}>
            {groups.map(({ resource, items }) => (
              <SuggestionGroup
                key={resource}
                resource={resource}
                items={items}
                open={isGroupOpen(resource)}
                onToggle={() => toggleGroup(resource)}
                onOpenCards={onOpenCards}
              />
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
