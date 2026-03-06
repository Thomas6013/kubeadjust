"use client";

import { useState } from "react";
import type { DeploymentDetail, ContainerHistory } from "@/lib/api";
import { computeSuggestions, type Suggestion, type SuggestionKind } from "@/lib/suggestions";
import styles from "./SuggestionPanel.module.css";

const KIND_META: Record<SuggestionKind, { icon: string; color: string; label: string; bg: string }> = {
  danger:   { icon: "▲", color: "var(--red)",       label: "critical",  bg: "rgba(252,129,129,0.15)" },
  warning:  { icon: "●", color: "var(--orange)",    label: "warning",   bg: "rgba(246,166,35,0.15)" },
  overkill: { icon: "▼", color: "var(--blue-over)", label: "over-prov", bg: "rgba(99,179,237,0.15)" },
};

const KIND_ORDER: SuggestionKind[] = ["danger", "warning", "overkill"];

// Resource categories for the filter chips
type ResourceCategory = "cpu" | "memory" | "storage";

const RESOURCE_TO_CATEGORY: Record<string, ResourceCategory> = {
  "CPU":                  "cpu",
  "CPU — no limit":       "cpu",
  "CPU — no request":     "cpu",
  "Memory":               "memory",
  "Memory — no limit":    "memory",
  "Memory — no request":  "memory",
  "Ephemeral":            "storage",
  "Ephemeral — no limit": "storage",
  "PVC":                  "storage",
  "EmptyDir":             "storage",
};

const CATEGORY_ORDER: ResourceCategory[] = ["cpu", "memory", "storage"];

const CATEGORY_META: Record<ResourceCategory, { label: string }> = {
  cpu:     { label: "CPU" },
  memory:  { label: "Memory" },
  storage: { label: "Storage" },
};

// Sort within a kind group by resource type
const RESOURCE_ORDER = [
  "CPU", "Memory",
  "CPU — no limit", "Memory — no limit",
  "CPU — no request", "Memory — no request",
  "Ephemeral — no limit", "Ephemeral", "PVC", "EmptyDir",
];

function resourceSortKey(resource: string): number {
  const idx = RESOURCE_ORDER.indexOf(resource);
  return idx === -1 ? 999 : idx;
}

function groupByKind(suggestions: Suggestion[]): Array<{ kind: SuggestionKind; items: Suggestion[] }> {
  const map = new Map<SuggestionKind, Suggestion[]>();
  for (const s of suggestions) {
    if (!map.has(s.kind)) map.set(s.kind, []);
    map.get(s.kind)!.push(s);
  }
  const groups: Array<{ kind: SuggestionKind; items: Suggestion[] }> = [];
  for (const kind of KIND_ORDER) {
    const items = map.get(kind);
    if (!items) continue;
    items.sort((a, b) => resourceSortKey(a.resource) - resourceSortKey(b.resource));
    groups.push({ kind, items });
  }
  return groups;
}

function suggestionKey(s: Suggestion): string {
  return `${s.deployment}:${s.pod}:${s.container}:${s.resource}:${s.kind}`;
}

const VOLUME_RESOURCES = new Set(["PVC", "EmptyDir"]);

function SuggestionItem({ s, onOpenCards }: { s: Suggestion; onOpenCards?: (ids: string[], scrollTarget: string) => void }) {
  const meta = KIND_META[s.kind];
  const scrollTarget = VOLUME_RESOURCES.has(s.resource)
    ? `pod-row-${s.deployment}-${s.pod}`
    : `container-${s.deployment}-${s.pod}-${s.container}`;
  return (
    <a
      href={`#${scrollTarget}`}
      className={styles.item}
      style={{ borderLeftColor: meta.color }}
      onClick={(e) => {
        e.preventDefault();
        onOpenCards?.([`dep:${s.deployment}`, `pod:${s.pod}`], scrollTarget);
      }}
    >
      <div className={styles.itemHeader}>
        <span className={styles.depName}>{s.deployment}</span>
        <span className={styles.podTag}>{s.pod.split("-").slice(-2).join("-")}</span>
        <span className={styles.resourceTag}>{s.resource}</span>
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
  kind: SuggestionKind;
  items: Suggestion[];
  open: boolean;
  onToggle: () => void;
  onOpenCards?: (ids: string[], scrollTarget: string) => void;
}

function SuggestionGroup({ kind, items, open, onToggle, onOpenCards }: SuggestionGroupProps) {
  const meta = KIND_META[kind];
  return (
    <div className={styles.group}>
      <button
        className={styles.groupHeader}
        style={{ color: meta.color, borderBottomColor: `${meta.color}44` }}
        onClick={onToggle}
      >
        <span className={styles.groupArrow}>{open ? "▾" : "▸"}</span>
        <span className={styles.groupIcon}>{meta.icon}</span>
        <span className={styles.groupLabel}>{meta.label}</span>
        <span className={styles.groupCount} style={{ background: meta.bg, color: meta.color }}>
          {items.length}
        </span>
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
  onOpenCards?: (ids: string[], scrollTarget: string) => void;
  searchQuery?: string;
}

export default function SuggestionPanel({ deployments, history, onOpenCards, searchQuery }: SuggestionPanelProps) {
  // --- Open/close per kind group ---
  const [openGroups, setOpenGroups] = useState<Map<string, boolean>>(new Map());

  function isGroupOpen(kind: string): boolean {
    return openGroups.get(kind) ?? true;
  }

  function toggleGroup(kind: string) {
    setOpenGroups((prev) => {
      const next = new Map(prev);
      next.set(kind, !(prev.get(kind) ?? true));
      return next;
    });
  }

  // --- Resource category chip filter (transient) ---
  const [activeCategories, setActiveCategories] = useState<Set<ResourceCategory>>(new Set());

  function toggleCategory(cat: ResourceCategory) {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  // --- Compute ---
  const allSuggestions = computeSuggestions(deployments, history);
  const q = searchQuery?.toLowerCase() ?? "";
  const searchFiltered = q
    ? allSuggestions.filter((s) =>
        s.deployment.toLowerCase().includes(q) || s.pod.toLowerCase().includes(q)
      )
    : allSuggestions;
  const filtered = activeCategories.size > 0
    ? searchFiltered.filter((s) => activeCategories.has(RESOURCE_TO_CATEGORY[s.resource] ?? "cpu"))
    : searchFiltered;

  const groups = groupByKind(filtered);

  // Category counts (before category filter, for chip display)
  const catCounts: Record<ResourceCategory, number> = { cpu: 0, memory: 0, storage: 0 };
  for (const s of searchFiltered) {
    const cat = RESOURCE_TO_CATEGORY[s.resource];
    if (cat) catCounts[cat]++;
  }

  return (
    <aside className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Suggestions</span>
        <span className={styles.total}>{searchFiltered.length}</span>
      </div>

      {searchFiltered.length === 0 ? (
        <div className={styles.allGood}>
          <span className={styles.allGoodIcon}>✓</span>
          <p>{q ? `No suggestions matching "${searchQuery}"` : "All resources look healthy"}</p>
        </div>
      ) : (
        <>
          {/* Resource category chips */}
          <div className={styles.summary}>
            {CATEGORY_ORDER.map((cat) => {
              if (catCounts[cat] === 0) return null;
              const isActive = activeCategories.has(cat);
              const isDimmed = activeCategories.size > 0 && !isActive;
              return (
                <button
                  key={cat}
                  type="button"
                  className={`${styles.chip} ${isActive ? styles.chipActive : ""} ${isDimmed ? styles.chipDimmed : ""}`}
                  onClick={() => toggleCategory(cat)}
                >
                  {CATEGORY_META[cat].label}
                  <span className={styles.chipCount}>{catCounts[cat]}</span>
                </button>
              );
            })}
          </div>

          <div className={styles.list}>
            {groups.map(({ kind, items }) => (
              <SuggestionGroup
                key={kind}
                kind={kind}
                items={items}
                open={isGroupOpen(kind)}
                onToggle={() => toggleGroup(kind)}
                onOpenCards={onOpenCards}
              />
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
