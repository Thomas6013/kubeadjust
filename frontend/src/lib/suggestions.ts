import { fmtRawValue } from "./api";
import type { DeploymentDetail, ContainerResources, ResourceValue, VolumeDetail, ContainerHistory } from "./api";

export type SuggestionKind = "danger" | "warning" | "overkill";

export interface Suggestion {
  deployment: string;
  pod: string;
  container: string;
  resource: string;
  kind: SuggestionKind;
  action: string;
  message: string;
  current: string;
  suggested: string;
}

/** Map of "pod/container" → ContainerHistory for quick lookup. */
export type HistoryMap = Map<string, ContainerHistory>;

export function buildHistoryMap(history: ContainerHistory[]): HistoryMap {
  const map = new Map<string, ContainerHistory>();
  for (const h of history) {
    map.set(`${h.pod}/${h.container}`, h);
  }
  return map;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)];
}

/** Extracts the numeric value from a ResourceValue (millicores for CPU, bytes for memory). */
function val(rv: ResourceValue | undefined, isCPU: boolean): number {
  if (!rv) return 0;
  return isCPU ? (rv.millicores ?? 0) : (rv.bytes ?? 0);
}


/** Generates CPU and memory suggestions for a container: danger/warning when near limit, overkill when far below request.
 *  When Prometheus history is available, uses P95 for danger/warning thresholds and mean for overkill detection. */
function analyzeCpuMem(c: ContainerResources, depName: string, podName: string, hist?: ContainerHistory): Suggestion[] {
  const results: Suggestion[] = [];
  for (const isCPU of [true, false]) {
    const label = isCPU ? "CPU" : "Memory";
    const req = val(isCPU ? c.requests.cpu : c.requests.memory, isCPU);
    const lim = val(isCPU ? c.limits.cpu : c.limits.memory, isCPU);
    if (!c.usage) continue;
    const snapshotUse = val(isCPU ? c.usage.cpu : c.usage.memory, isCPU);
    if (snapshotUse === 0) continue;

    // Use Prometheus history if available, otherwise fall back to snapshot
    const histPoints = hist ? (isCPU ? hist.cpu : hist.memory).map((p) => p.v) : [];
    const hasHistory = histPoints.length >= 2;
    const p95Use = hasHistory ? percentile95(histPoints) : snapshotUse;
    const meanUse = hasHistory ? mean(histPoints) : snapshotUse;
    const source = hasHistory ? "avg" : "current";
    const confidence = !hasHistory ? "" : histPoints.length >= 400 ? " · high confidence" : histPoints.length >= 60 ? " · medium confidence" : " · low confidence";

    // No request defined — flag it
    if (req === 0) {
      const suggested = meanUse > 0 ? Math.ceil(meanUse * 1.3) : Math.ceil(snapshotUse * 1.3);
      results.push({ deployment: depName, pod: podName, container: c.name, resource: `${label} — no request`, kind: "warning",
        action: "Set request",
        message: `No ${label} request set — scheduler cannot guarantee resources`,
        current: "none", suggested: fmtRawValue(suggested, isCPU) });
    }
    // No limit defined — flag it
    if (lim === 0) {
      const suggested = p95Use > 0 ? Math.ceil(p95Use * 1.5) : Math.ceil(snapshotUse * 2);
      results.push({ deployment: depName, pod: podName, container: c.name, resource: `${label} — no limit`, kind: "warning",
        action: "Set limit",
        message: `No ${label} limit set — container can consume unbounded ${label.toLowerCase()}`,
        current: "unlimited", suggested: fmtRawValue(suggested, isCPU) });
    }
    if (lim > 0) {
      const pct = p95Use / lim;
      if (pct >= 0.90) {
        results.push({ deployment: depName, pod: podName, container: c.name, resource: label, kind: "danger",
          action: "Increase limit",
          message: `${label} P95 usage at ${Math.round(pct * 100)}% of limit${confidence}`,
          current: fmtRawValue(lim, isCPU), suggested: fmtRawValue(Math.ceil(p95Use * 1.4), isCPU) });
      } else if (pct >= 0.70) {
        results.push({ deployment: depName, pod: podName, container: c.name, resource: label, kind: "warning",
          action: "Increase limit",
          message: `${label} P95 usage at ${Math.round(pct * 100)}% of limit${confidence}`,
          current: fmtRawValue(lim, isCPU), suggested: fmtRawValue(Math.ceil(p95Use * 1.4), isCPU) });
      }
    }
    const requestOverkill = req > 0 && meanUse / req <= 0.35;
    if (requestOverkill) {
      results.push({ deployment: depName, pod: podName, container: c.name, resource: label, kind: "overkill",
        action: "Reduce request",
        message: `${label} ${source} request is ${(req / meanUse).toFixed(1)}× actual usage${confidence}`,
        current: fmtRawValue(req, isCPU), suggested: fmtRawValue(Math.ceil(meanUse * 1.3), isCPU) });
    }
    // Limit over-provisioned: limit is more than 3× P95 usage
    if (lim > 0 && p95Use > 0 && lim / p95Use >= 3) {
      results.push({ deployment: depName, pod: podName, container: c.name, resource: label, kind: "overkill",
        action: "Reduce limit",
        message: `${label} limit is ${(lim / p95Use).toFixed(1)}× P95 usage${confidence}`,
        current: fmtRawValue(lim, isCPU), suggested: fmtRawValue(Math.ceil(p95Use * 1.5), isCPU) });
    }
    // Request too low: P95 usage consistently exceeds request (only when not already flagged as overkill)
    if (req > 0 && !requestOverkill && p95Use > req * 1.1) {
      const ratio = p95Use / req;
      const kind: SuggestionKind = ratio >= 2 ? "danger" : "warning";
      results.push({ deployment: depName, pod: podName, container: c.name, resource: label, kind,
        action: "Increase request",
        message: `${label} ${source} usage is ${ratio.toFixed(1)}× the request — pod may be throttled or evicted${confidence}`,
        current: fmtRawValue(req, isCPU), suggested: fmtRawValue(Math.ceil(p95Use * 1.3), isCPU) });
    }
  }
  return results;
}

/** Generates ephemeral storage suggestions: flags missing limits, warns near capacity. */
function analyzeEphemeral(c: ContainerResources, depName: string, podName: string): Suggestion[] {
  const eph = c.ephemeralStorage;
  if (!eph?.usage) return [];
  const use = eph.usage.bytes ?? 0;
  if (use === 0) return [];

  const results: Suggestion[] = [];
  const lim = eph.limit?.bytes ?? 0;

  if (lim === 0) {
    results.push({ deployment: depName, pod: podName, container: c.name, resource: "Ephemeral — no limit", kind: "warning",
      action: "Set limit",
      message: "No ephemeral-storage limit set",
      current: "unlimited", suggested: fmtRawValue(Math.ceil(use * 2), false) });
  } else {
    const pct = use / lim;
    if (pct >= 0.90) {
      results.push({ deployment: depName, pod: podName, container: c.name, resource: "Ephemeral", kind: "danger",
        action: "Increase limit",
        message: `Ephemeral usage at ${Math.round(pct * 100)}% of limit`,
        current: fmtRawValue(lim, false), suggested: fmtRawValue(Math.ceil(use * 1.5), false) });
    } else if (pct >= 0.70) {
      results.push({ deployment: depName, pod: podName, container: c.name, resource: "Ephemeral", kind: "warning",
        action: "Increase limit",
        message: `Ephemeral usage at ${Math.round(pct * 100)}% of limit`,
        current: fmtRawValue(lim, false), suggested: fmtRawValue(Math.ceil(use * 1.5), false) });
    }
  }
  return results;
}

/** Generates volume suggestions: PVC near capacity, emptyDir without sizeLimit. */
function analyzeVolumes(volumes: VolumeDetail[], depName: string, podName: string): Suggestion[] {
  const results: Suggestion[] = [];
  for (const vol of volumes) {
    const use = vol.usage?.bytes ?? 0;
    if (use === 0) continue;

    if (vol.type === "pvc") {
      const cap = vol.capacity?.bytes ?? 0;
      if (cap > 0) {
        const pct = use / cap;
        if (pct >= 0.90) {
          results.push({ deployment: depName, pod: podName, container: vol.pvcName ?? vol.name, resource: "PVC",
            kind: "danger", action: "Expand PVC",
            message: `PVC "${vol.pvcName}" at ${Math.round(pct * 100)}% capacity`,
            current: fmtRawValue(cap, false), suggested: fmtRawValue(Math.ceil(cap * 1.5), false) });
        } else if (pct >= 0.75) {
          results.push({ deployment: depName, pod: podName, container: vol.pvcName ?? vol.name, resource: "PVC",
            kind: "warning", action: "Expand PVC",
            message: `PVC "${vol.pvcName}" at ${Math.round(pct * 100)}% capacity`,
            current: fmtRawValue(cap, false), suggested: fmtRawValue(Math.ceil(cap * 1.5), false) });
        }
      }
    }

    if (vol.type === "emptyDir" && !vol.sizeLimit) {
      results.push({ deployment: depName, pod: podName, container: vol.name, resource: "EmptyDir",
        kind: "warning", action: "Set sizeLimit",
        message: `EmptyDir "${vol.name}" has no sizeLimit`,
        current: "unlimited", suggested: fmtRawValue(Math.ceil(use * 2), false) });
    }
  }
  return results;
}

/** Computes all suggestions across all workloads, sorted by severity (danger → warning → overkill).
 *  When history is provided, suggestions are weighted with Prometheus P95/mean data. */
export function computeSuggestions(deployments: DeploymentDetail[], history?: ContainerHistory[]): Suggestion[] {
  const histMap = history && history.length > 0 ? buildHistoryMap(history) : undefined;
  const out: Suggestion[] = [];
  for (const dep of deployments) {
    for (const pod of dep.pods ?? []) {
      for (const c of pod.containers) {
        const hist = histMap?.get(`${pod.name}/${c.name}`);
        out.push(...analyzeCpuMem(c, dep.name, pod.name, hist));
        out.push(...analyzeEphemeral(c, dep.name, pod.name));
      }
      out.push(...analyzeVolumes(pod.volumes ?? [], dep.name, pod.name));
    }
  }
  const order: Record<SuggestionKind, number> = { danger: 0, warning: 1, overkill: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}

/** Returns the color status for a resource bar based on usage vs request/limit thresholds. */
export function resourceStatus(
  use: ResourceValue | undefined,
  req: ResourceValue | undefined,
  lim: ResourceValue | undefined,
  isCPU: boolean,
): "danger" | "warning" | "overkill" | "healthy" | "none" {
  if (!use) return "none";
  const u = isCPU ? (use.millicores ?? 0) : (use.bytes ?? 0);
  const l = lim ? (isCPU ? (lim.millicores ?? 0) : (lim.bytes ?? 0)) : 0;
  const r = req ? (isCPU ? (req.millicores ?? 0) : (req.bytes ?? 0)) : 0;
  if (u === 0) return "none";
  if (l > 0 && u / l >= 0.90) return "danger";
  if (l > 0 && u / l >= 0.70) return "warning";
  if (r > 0 && u / r <= 0.35) return "overkill";
  return "healthy";
}

/** Returns the color status for a storage bar. Always warns when no limit is set. */
export function storageStatus(
  use: ResourceValue | undefined,
  capacity: ResourceValue | undefined,
  hasLimit: boolean,
): "danger" | "warning" | "overkill" | "healthy" | "none" {
  if (!use) return "none";
  const u = use.bytes ?? 0;
  if (u === 0) return "none";
  if (!hasLimit) return "warning"; // no limit = always flag
  const c = capacity?.bytes ?? 0;
  if (c === 0) return "none";
  const pct = u / c;
  if (pct >= 0.90) return "danger";
  if (pct >= 0.75) return "warning";
  return "healthy";
}
