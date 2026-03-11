const PALETTE = [
  { accent: "#60a5fa", bg: "rgba(96,165,250,0.12)", border: "rgba(96,165,250,0.35)" },   // blue
  { accent: "#4ade80", bg: "rgba(74,222,128,0.10)", border: "rgba(74,222,128,0.30)" },   // green
  { accent: "#fb923c", bg: "rgba(251,146,60,0.10)", border: "rgba(251,146,60,0.30)" },   // orange
  { accent: "#c084fc", bg: "rgba(192,132,252,0.10)", border: "rgba(192,132,252,0.30)" }, // purple
  { accent: "#22d3ee", bg: "rgba(34,211,238,0.10)", border: "rgba(34,211,238,0.30)" },   // cyan
  { accent: "#f472b6", bg: "rgba(244,114,182,0.10)", border: "rgba(244,114,182,0.30)" }, // pink
  { accent: "#a3e635", bg: "rgba(163,230,53,0.10)",  border: "rgba(163,230,53,0.30)" },  // lime
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function clusterColor(name: string) {
  return PALETTE[hashStr(name) % PALETTE.length];
}
