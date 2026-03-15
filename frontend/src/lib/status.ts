/** Shared status → color mapping for resource bars, sparklines, and volume indicators. */
export const STATUS_COLOR: Record<string, string> = {
  danger:   "var(--red)",
  warning:  "var(--orange)",
  overkill: "var(--blue-over)",
  healthy:  "var(--green)",
  none:     "var(--muted)",
};

/** Shared status → badge label mapping for resource bars. */
export const STATUS_LABEL: Record<string, string> = {
  danger:   "CRITICAL",
  warning:  "WARNING",
  overkill: "OVER-PROV",
  healthy:  "",
  none:     "NO DATA",
};

/**
 * Shorten a K8s pod name by stripping the two trailing random suffixes
 * (e.g. "my-app-7b5f8c6d4-x9j2k" → "my-app").
 */
export function shortPodName(name: string): string {
  const parts = name.split("-");
  return parts.length > 3 ? parts.slice(0, -2).join("-") : name;
}
