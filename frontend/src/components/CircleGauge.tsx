import type { ResourceValue } from "@/lib/api";
import { fmtCPU, fmtMemory } from "@/lib/api";
import styles from "./NodeCard.module.css";

const SIZE = 130;
const CX = SIZE / 2;
const ROUT = 50;
const RIN  = 33;
const COUT = 2 * Math.PI * ROUT;
const CIN  = 2 * Math.PI * RIN;

function pct(a: ResourceValue, b: ResourceValue, isCPU: boolean): number {
  const av = isCPU ? (a.millicores ?? 0) : (a.bytes ?? 0);
  const bv = isCPU ? (b.millicores ?? 0) : (b.bytes ?? 0);
  if (bv === 0) return 0;
  return Math.min(100, Math.round((av / bv) * 100));
}

function gaugeColor(p: number): string {
  if (p >= 90) return "var(--red)";
  if (p >= 70) return "var(--orange)";
  if (p <= 20) return "var(--blue-over)";
  return "var(--green)";
}

export interface CircleGaugeProps {
  label: string;
  allocatable: ResourceValue;
  requested: ResourceValue;
  limited: ResourceValue;
  usage?: ResourceValue;
  isCPU: boolean;
}

export default function CircleGauge({ label, allocatable, requested, limited, usage, isCPU }: CircleGaugeProps) {
  const fmt = isCPU ? fmtCPU : fmtMemory;
  const allocPct = pct(requested, allocatable, isCPU);
  const usePct   = usage ? pct(usage, allocatable, isCPU) : null;
  const allocColor = gaugeColor(allocPct);
  const useColor   = usePct !== null ? gaugeColor(usePct) : "var(--border)";
  const mainPct    = usePct ?? allocPct;
  const mainColor  = usePct !== null ? useColor : allocColor;
  const overProv   = usePct !== null && allocPct > usePct + 15;

  const limVal   = isCPU ? (limited.millicores ?? 0) : (limited.bytes ?? 0);
  const allocVal = isCPU ? (allocatable.millicores ?? 0) : (allocatable.bytes ?? 0);
  const limPct   = allocVal > 0 ? Math.round((limVal / allocVal) * 100) : 0;
  const overcommit = limVal > allocVal;

  return (
    <div className={styles.gauge}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle cx={CX} cy={CX} r={ROUT} fill="none" stroke="var(--surface2)" strokeWidth={8} />
        {usePct !== null && (
          <circle
            cx={CX} cy={CX} r={ROUT}
            fill="none"
            stroke={useColor}
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={`${COUT} ${COUT}`}
            strokeDashoffset={COUT * (1 - usePct / 100)}
            transform={`rotate(-90 ${CX} ${CX})`}
            style={{ transition: "stroke-dashoffset 0.5s ease" }}
          />
        )}
        <circle cx={CX} cy={CX} r={RIN} fill="none" stroke="var(--surface2)" strokeWidth={6} />
        <circle
          cx={CX} cy={CX} r={RIN}
          fill="none"
          stroke={allocColor}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={`${CIN} ${CIN}`}
          strokeDashoffset={CIN * (1 - allocPct / 100)}
          transform={`rotate(-90 ${CX} ${CX})`}
          opacity={0.6}
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
        <text x={CX} y={CX - 7} textAnchor="middle" dominantBaseline="middle" fontSize={20} fontWeight={700} fill={mainColor} style={{ fontFamily: "inherit" }}>
          {mainPct}%
        </text>
        <text x={CX} y={CX + 13} textAnchor="middle" dominantBaseline="middle" fontSize={10} fontWeight={600} fill="var(--muted)" style={{ fontFamily: "inherit" }}>
          {usePct !== null ? "USAGE" : "ALLOC"}
        </text>
      </svg>

      <div className={styles.gaugeInfo}>
        <span className={styles.gaugeLabel}>{label}</span>
        <div className={styles.gaugeLine}>
          <span className={styles.gaugeDot} style={{ background: allocColor }} />
          <span>alloc <strong>{allocPct}%</strong> · {fmt(requested)}</span>
        </div>
        {usePct !== null ? (
          <div className={styles.gaugeLine}>
            <span className={styles.gaugeDot} style={{ background: useColor }} />
            <span>use <strong>{usePct}%</strong> · {usage ? fmt(usage) : "—"}</span>
          </div>
        ) : (
          <span className={styles.gaugeNoData}>no metrics</span>
        )}
        <div className={styles.gaugeLine}>
          <span className={styles.gaugeDot} style={{ background: overcommit ? "var(--red)" : "var(--muted)", opacity: 0.5 }} />
          <span style={{ color: overcommit ? "var(--red)" : "var(--muted)" }}>
            lim <strong>{limPct}%</strong> · {fmt(limited)}
          </span>
          {overcommit && <span className={styles.overcommitBadge}>OVERCOMMIT</span>}
        </div>
        <span className={styles.gaugeAllocatable}>{fmt(allocatable)} allocatable</span>
        {overProv && (
          <span className={styles.gaugeGap}>▼ {allocPct - (usePct ?? 0)}pp gap</span>
        )}
      </div>
    </div>
  );
}
