"use client";

import { useState, useEffect, type Dispatch, type SetStateAction } from "react";
import { STORAGE_KEYS, safeGetItem, safeSetItem } from "@/lib/storage";
import type { TimeRange } from "@/lib/api";

export type View = "namespaces" | "nodes";
export type AutoRefresh = "off" | "30s" | "60s" | "5m";

export const AUTO_REFRESH_MS: Record<AutoRefresh, number> = {
  off: 0, "30s": 30_000, "60s": 60_000, "5m": 300_000,
};

export interface SessionState {
  view: View;
  setView: (v: View) => void;
  autoRefresh: AutoRefresh;
  setAutoRefresh: (a: AutoRefresh) => void;
  selectedNs: string;
  setSelectedNs: (ns: string) => void;
  timeRange: TimeRange;
  setTimeRange: (r: TimeRange) => void;
  openCards: Set<string>;
  setOpenCards: Dispatch<SetStateAction<Set<string>>>;
  excludedNs: Set<string>;
  setExcludedNs: Dispatch<SetStateAction<Set<string>>>;
}

/**
 * Manages all sessionStorage-backed dashboard preferences.
 * Restores state on mount, persists changes after restore completes.
 */
export function useSessionState(): SessionState {
  const [view, setView] = useState<View>("nodes");
  const [autoRefresh, setAutoRefresh] = useState<AutoRefresh>("off");
  const [selectedNs, setSelectedNs] = useState<string>("");
  const [timeRange, setTimeRange] = useState<TimeRange>("1h");
  const [openCards, setOpenCards] = useState<Set<string>>(new Set());
  const [excludedNs, setExcludedNs] = useState<Set<string>>(new Set());
  const [restored, setRestored] = useState(false);

  // Restore all preferences from sessionStorage on mount
  useEffect(() => {
    const savedAR = safeGetItem(STORAGE_KEYS.autoRefresh) as AutoRefresh | null;
    if (savedAR && savedAR in AUTO_REFRESH_MS) setAutoRefresh(savedAR);
    const savedView = safeGetItem(STORAGE_KEYS.view) as View | null;
    if (savedView) setView(savedView);
    const savedNs = safeGetItem(STORAGE_KEYS.selectedNs);
    if (savedNs) setSelectedNs(savedNs);
    const savedRange = safeGetItem(STORAGE_KEYS.timeRange) as TimeRange | null;
    if (savedRange) setTimeRange(savedRange);
    try {
      const rawCards = safeGetItem(STORAGE_KEYS.openCards);
      if (rawCards) setOpenCards(new Set(JSON.parse(rawCards) as string[]));
    } catch { /* corrupted data — keep default */ }
    try {
      const raw = safeGetItem(STORAGE_KEYS.excludedNs);
      if (raw) setExcludedNs(new Set(JSON.parse(raw) as string[]));
    } catch { /* corrupted data — keep default */ }
    setRestored(true);
  }, []);

  // Persist changes back to sessionStorage (gated on restored to avoid overwriting on first render)
  useEffect(() => { if (restored) safeSetItem(STORAGE_KEYS.view, view); }, [view, restored]);
  useEffect(() => { if (restored) safeSetItem(STORAGE_KEYS.autoRefresh, autoRefresh); }, [autoRefresh, restored]);
  useEffect(() => { if (restored && selectedNs) safeSetItem(STORAGE_KEYS.selectedNs, selectedNs); }, [selectedNs, restored]);
  useEffect(() => { if (restored) safeSetItem(STORAGE_KEYS.timeRange, timeRange); }, [timeRange, restored]);
  useEffect(() => { if (restored) safeSetItem(STORAGE_KEYS.openCards, JSON.stringify([...openCards])); }, [openCards, restored]);

  return { view, setView, autoRefresh, setAutoRefresh, selectedNs, setSelectedNs, timeRange, setTimeRange, openCards, setOpenCards, excludedNs, setExcludedNs };
}
