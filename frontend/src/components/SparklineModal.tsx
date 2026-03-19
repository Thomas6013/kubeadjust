"use client";

import { useEffect, useCallback, useMemo } from "react";
import type { DataPoint } from "@/lib/api";
import styles from "./SparklineModal.module.css";

interface SparklineModalProps {
  isOpen: boolean;
  onClose: () => void;
  dataPoints: DataPoint[];
  label: string;
  color: string;
  isCPU: boolean;
  title: string;
}

function fmtVal(v: number, isCPU: boolean): string {
  if (isCPU) {
    if (v >= 1000) return `${(v / 1000).toFixed(2)}c`;
    return `${Math.round(v)}m`;
  }
  const gib = v / 1024 ** 3;
  if (gib >= 1) return `${gib.toFixed(2)} GiB`;
  const mib = v / 1024 ** 2;
  if (mib >= 1) return `${mib.toFixed(0)} MiB`;
  return `${(v / 1024).toFixed(0)} KiB`;
}

function fmtTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const W = 540;
const H = 130;
const PAD = { top: 12, right: 16, bottom: 28, left: 10 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;

export default function SparklineModal({ isOpen, onClose, dataPoints, label, color, isCPU, title }: SparklineModalProps) {
  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, handleKey]);

  const { minV, maxV, pathD, fillD, tickIdxs, current, xs, ys } = useMemo(() => {
    const values = dataPoints.map((p) => p.v);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const rangeV = maxV - minV || 1;
    const xs = dataPoints.map((_, i) => PAD.left + (i / (dataPoints.length - 1)) * INNER_W);
    const ys = dataPoints.map((p) => PAD.top + (1 - (p.v - minV) / rangeV) * INNER_H);
    const pathD = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
    const fillD = `${pathD} L${xs[xs.length - 1].toFixed(1)},${(PAD.top + INNER_H).toFixed(1)} L${PAD.left.toFixed(1)},${(PAD.top + INNER_H).toFixed(1)} Z`;
    const tickCount = Math.min(5, dataPoints.length);
    const tickIdxs = Array.from({ length: tickCount }, (_, i) => Math.round((i / (tickCount - 1)) * (dataPoints.length - 1)));
    return { minV, maxV, pathD, fillD, tickIdxs, current: values[values.length - 1], xs, ys };
  }, [dataPoints]);

  if (!isOpen || dataPoints.length < 2) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.label} style={{ color }}>{label}</span>
          <span className={styles.title}>{title}</span>
          <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className={styles.chart}>
          {/* Fill */}
          <defs>
            <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={fillD} fill="url(#sparkFill)" />

          {/* Baseline */}
          <line
            x1={PAD.left} y1={PAD.top + INNER_H}
            x2={PAD.left + INNER_W} y2={PAD.top + INNER_H}
            stroke="var(--border)" strokeWidth={1}
          />

          {/* Curve */}
          <path d={pathD} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

          {/* Current value dot */}
          <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r={3.5} fill={color} />

          {/* X-axis time labels */}
          {tickIdxs.map((idx) => (
            <text
              key={idx}
              x={xs[idx]}
              y={H - 4}
              textAnchor="middle"
              fontSize={9}
              fill="var(--muted)"
              fontFamily="monospace"
            >
              {fmtTime(dataPoints[idx].t)}
            </text>
          ))}

          {/* Min / Max labels */}
          <text x={PAD.left + 2} y={PAD.top + 9} fontSize={9} fill="var(--muted)" fontFamily="monospace">
            max {fmtVal(maxV, isCPU)}
          </text>
          <text x={PAD.left + 2} y={PAD.top + INNER_H - 3} fontSize={9} fill="var(--muted)" fontFamily="monospace">
            min {fmtVal(minV, isCPU)}
          </text>
        </svg>

        <div className={styles.stats}>
          <span className={styles.stat}>
            <span className={styles.statLabel}>min</span>
            <strong>{fmtVal(minV, isCPU)}</strong>
          </span>
          <span className={styles.stat}>
            <span className={styles.statLabel}>max</span>
            <strong>{fmtVal(maxV, isCPU)}</strong>
          </span>
          <span className={styles.stat} style={{ color }}>
            <span className={styles.statLabel}>now</span>
            <strong>{fmtVal(current, isCPU)}</strong>
          </span>
          <span className={styles.stat}>
            <span className={styles.statLabel}>pts</span>
            <strong>{dataPoints.length}</strong>
          </span>
        </div>
      </div>
    </div>
  );
}
