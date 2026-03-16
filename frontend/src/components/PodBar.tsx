import type { PodDetail } from "@/lib/api";
import { fmtCPU, fmtMemory } from "@/lib/api";
import { shortPodName } from "@/lib/status";
import styles from "./NodeCard.module.css";

function barColor(usePct: number | null, reqPct: number): string {
  if (usePct !== null) {
    if (usePct >= 90) return "var(--red)";
    if (usePct >= 70) return "var(--orange)";
    return "var(--green)";
  }
  if (reqPct >= 90) return "var(--red)";
  if (reqPct >= 70) return "var(--orange)";
  return "var(--accent)";
}

interface PodBarProps {
  pod: PodDetail;
  allocCPU: number;
  allocMem: number;
}

export default function PodBar({ pod, allocCPU, allocMem }: PodBarProps) {
  let cpuReq = 0, cpuUse = 0, memReq = 0, memUse = 0;
  let hasUsage = false;
  for (const c of pod.containers) {
    cpuReq += c.requests.cpu.millicores ?? 0;
    memReq += c.requests.memory.bytes ?? 0;
    if (c.usage) {
      hasUsage = true;
      cpuUse += c.usage.cpu.millicores ?? 0;
      memUse += c.usage.memory.bytes ?? 0;
    }
  }

  const cpuReqPct = allocCPU > 0 ? Math.min(100, (cpuReq / allocCPU) * 100) : 0;
  const cpuUsePct = hasUsage && allocCPU > 0 ? Math.min(100, (cpuUse / allocCPU) * 100) : null;
  const memReqPct = allocMem > 0 ? Math.min(100, (memReq / allocMem) * 100) : 0;
  const memUsePct = hasUsage && allocMem > 0 ? Math.min(100, (memUse / allocMem) * 100) : null;

  const cpuColor = barColor(cpuUsePct, cpuReqPct);
  const memColor = barColor(memUsePct, memReqPct);

  const shortName = shortPodName(pod.name);

  const cpuTooltip = cpuUsePct !== null
    ? `req: ${fmtCPU({ raw: "", millicores: cpuReq })} (${cpuReqPct.toFixed(0)}%) · use: ${fmtCPU({ raw: "", millicores: cpuUse })} (${cpuUsePct.toFixed(0)}%)`
    : `req: ${fmtCPU({ raw: "", millicores: cpuReq })} (${cpuReqPct.toFixed(0)}%) · no usage data`;
  const memTooltip = memUsePct !== null
    ? `req: ${fmtMemory({ raw: "", bytes: memReq })} (${memReqPct.toFixed(0)}%) · use: ${fmtMemory({ raw: "", bytes: memUse })} (${memUsePct.toFixed(0)}%)`
    : `req: ${fmtMemory({ raw: "", bytes: memReq })} (${memReqPct.toFixed(0)}%) · no usage data`;

  return (
    <div className={styles.podBar} title={pod.namespace ? `${pod.namespace}/${pod.name}` : pod.name}>
      <span className={styles.podBarName}>{shortName}</span>
      <div className={styles.podBarBars}>
        <div className={styles.podBarRow}>
          <span className={styles.podBarLabel}>CPU</span>
          <div className={styles.podBarTrack} title={cpuTooltip}>
            <div className={styles.podBarFill} style={{ width: `${cpuReqPct.toFixed(1)}%`, background: cpuColor + "55" }} />
            {cpuUsePct !== null && (
              <div className={styles.podBarUseFill} style={{ width: `${cpuUsePct.toFixed(1)}%`, background: cpuColor }} />
            )}
          </div>
          <span className={styles.podBarPct} style={{ color: cpuUsePct !== null ? cpuColor : "var(--muted)" }}>
            {cpuUsePct !== null ? `${cpuUsePct.toFixed(0)}%` : `${cpuReqPct.toFixed(0)}%`}
          </span>
        </div>
        <div className={styles.podBarRow}>
          <span className={styles.podBarLabel}>MEM</span>
          <div className={styles.podBarTrack} title={memTooltip}>
            <div className={styles.podBarFill} style={{ width: `${memReqPct.toFixed(1)}%`, background: memColor + "55" }} />
            {memUsePct !== null && (
              <div className={styles.podBarUseFill} style={{ width: `${memUsePct.toFixed(1)}%`, background: memColor }} />
            )}
          </div>
          <span className={styles.podBarPct} style={{ color: memUsePct !== null ? memColor : "var(--muted)" }}>
            {memUsePct !== null ? `${memUsePct.toFixed(0)}%` : `${memReqPct.toFixed(0)}%`}
          </span>
        </div>
      </div>
    </div>
  );
}
