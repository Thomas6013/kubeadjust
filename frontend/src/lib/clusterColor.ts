const PALETTE = [
  { accent: "#60a5fa", bg: "rgba(96,165,250,0.10)",  border: "rgba(96,165,250,0.28)"  }, // blue
  { accent: "#34d399", bg: "rgba(52,211,153,0.10)",  border: "rgba(52,211,153,0.28)"  }, // emerald
  { accent: "#f59e0b", bg: "rgba(245,158,11,0.10)",  border: "rgba(245,158,11,0.28)"  }, // amber
  { accent: "#a78bfa", bg: "rgba(167,139,250,0.10)", border: "rgba(167,139,250,0.28)" }, // violet
  { accent: "#22d3ee", bg: "rgba(34,211,238,0.10)",  border: "rgba(34,211,238,0.28)"  }, // cyan
  { accent: "#f472b6", bg: "rgba(244,114,182,0.10)", border: "rgba(244,114,182,0.28)" }, // pink
  { accent: "#fb923c", bg: "rgba(251,146,60,0.10)",  border: "rgba(251,146,60,0.28)"  }, // orange
];

export type ClusterColorEntry = (typeof PALETTE)[0];

/**
 * Builds a Map<clusterName, color> from a list of cluster names.
 * Colors are assigned by alphabetical position so no two clusters share a color
 * (up to 7 clusters; beyond that colors cycle but adjacent names stay distinct).
 */
export function buildClusterColors(names: string[]): Map<string, ClusterColorEntry> {
  const sorted = [...names].sort();
  const map = new Map<string, ClusterColorEntry>();
  sorted.forEach((name, i) => map.set(name, PALETTE[i % PALETTE.length]));
  return map;
}

/** Fallback for single-name lookups (e.g. when the full list is unavailable). */
export function clusterColor(name: string): ClusterColorEntry {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}
