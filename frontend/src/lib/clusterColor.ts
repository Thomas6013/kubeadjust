const PALETTE = [
  { accent: "#60a5fa", bg: "rgba(96,165,250,0.10)",  border: "rgba(96,165,250,0.28)"  }, // blue
  { accent: "#34d399", bg: "rgba(52,211,153,0.10)",  border: "rgba(52,211,153,0.28)"  }, // emerald
  { accent: "#f59e0b", bg: "rgba(245,158,11,0.10)",  border: "rgba(245,158,11,0.28)"  }, // amber
  { accent: "#a78bfa", bg: "rgba(167,139,250,0.10)", border: "rgba(167,139,250,0.28)" }, // violet
  { accent: "#22d3ee", bg: "rgba(34,211,238,0.10)",  border: "rgba(34,211,238,0.28)"  }, // cyan
  { accent: "#f472b6", bg: "rgba(244,114,182,0.10)", border: "rgba(244,114,182,0.28)" }, // pink
  { accent: "#fb923c", bg: "rgba(251,146,60,0.10)",  border: "rgba(251,146,60,0.28)"  }, // orange
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function clusterColor(name: string) {
  return PALETTE[hashStr(name) % PALETTE.length];
}
