interface SparklineProps {
  points: number[];
  color: string;
  width?: number;
  height?: number;
}

export default function Sparkline({ points, color, width = 120, height = 32 }: SparklineProps) {
  if (points.length < 2) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;

  const pad = 1;
  const xs = points.map((_, i) => pad + (i / (points.length - 1)) * (width - pad * 2));
  const ys = points.map((v) => pad + (1 - (v - min) / range) * (height - pad * 2));

  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ flexShrink: 0, opacity: 0.85 }}
      aria-hidden="true"
    >
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
