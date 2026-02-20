import type { DeploymentDetail, ContainerResources, ResourceValue, VolumeDetail } from "./api";

export type SuggestionKind = "danger" | "warning" | "overkill";

export interface Suggestion {
  deployment: string;
  container: string;
  resource: string;
  kind: SuggestionKind;
  message: string;
  current: string;
  suggested: string;
}

function val(rv: ResourceValue | undefined, isCPU: boolean): number {
  if (!rv) return 0;
  return isCPU ? (rv.millicores ?? 0) : (rv.bytes ?? 0);
}

function fmtSuggested(v: number, isCPU: boolean): string {
  if (isCPU) {
    if (v >= 1000) return `${(v / 1000).toFixed(2)} cores`;
    return `${v}m`;
  }
  const gib = v / 1024 ** 3;
  if (gib >= 1) return `${gib.toFixed(2)} GiB`;
  const mib = v / 1024 ** 2;
  if (mib >= 1) return `${Math.ceil(mib)} MiB`;
  return `${Math.ceil(v / 1024)} KiB`;
}

function analyzeCpuMem(c: ContainerResources, depName: string): Suggestion[] {
  const results: Suggestion[] = [];
  for (const isCPU of [true, false]) {
    const label = isCPU ? "CPU" : "Memory";
    const req = val(isCPU ? c.requests.cpu : c.requests.memory, isCPU);
    const lim = val(isCPU ? c.limits.cpu : c.limits.memory, isCPU);
    if (!c.usage) continue;
    const use = val(isCPU ? c.usage.cpu : c.usage.memory, isCPU);
    if (use === 0) continue;

    if (lim > 0) {
      const pct = use / lim;
      if (pct >= 0.90) {
        results.push({ deployment: depName, container: c.name, resource: label, kind: "danger",
          message: `${label} usage at ${Math.round(pct * 100)}% of limit`,
          current: fmtSuggested(lim, isCPU), suggested: fmtSuggested(Math.ceil(use * 1.4), isCPU) });
      } else if (pct >= 0.70) {
        results.push({ deployment: depName, container: c.name, resource: label, kind: "warning",
          message: `${label} usage at ${Math.round(pct * 100)}% of limit`,
          current: fmtSuggested(lim, isCPU), suggested: fmtSuggested(Math.ceil(use * 1.4), isCPU) });
      }
    }
    if (req > 0 && use / req <= 0.35) {
      results.push({ deployment: depName, container: c.name, resource: label, kind: "overkill",
        message: `${label} request is ${(req / use).toFixed(1)}× actual usage`,
        current: fmtSuggested(req, isCPU), suggested: fmtSuggested(Math.ceil(use * 1.3), isCPU) });
    }
  }
  return results;
}

function analyzeEphemeral(c: ContainerResources, depName: string): Suggestion[] {
  const eph = c.ephemeralStorage;
  if (!eph?.usage) return [];
  const use = eph.usage.bytes ?? 0;
  if (use === 0) return [];

  const results: Suggestion[] = [];
  const lim = eph.limit?.bytes ?? 0;

  if (lim === 0) {
    // No limit set — always flag it
    results.push({ deployment: depName, container: c.name, resource: "Ephemeral", kind: "warning",
      message: "No ephemeral-storage limit set",
      current: "unlimited", suggested: fmtSuggested(Math.ceil(use * 2), false) });
  } else {
    const pct = use / lim;
    if (pct >= 0.90) {
      results.push({ deployment: depName, container: c.name, resource: "Ephemeral", kind: "danger",
        message: `Ephemeral usage at ${Math.round(pct * 100)}% of limit`,
        current: fmtSuggested(lim, false), suggested: fmtSuggested(Math.ceil(use * 1.5), false) });
    } else if (pct >= 0.70) {
      results.push({ deployment: depName, container: c.name, resource: "Ephemeral", kind: "warning",
        message: `Ephemeral usage at ${Math.round(pct * 100)}% of limit`,
        current: fmtSuggested(lim, false), suggested: fmtSuggested(Math.ceil(use * 1.5), false) });
    }
  }
  return results;
}

function analyzeVolumes(volumes: VolumeDetail[], depName: string): Suggestion[] {
  const results: Suggestion[] = [];
  for (const vol of volumes) {
    const use = vol.usage?.bytes ?? 0;
    if (use === 0) continue;

    if (vol.type === "pvc") {
      const cap = vol.capacity?.bytes ?? 0;
      if (cap > 0) {
        const pct = use / cap;
        if (pct >= 0.90) {
          results.push({ deployment: depName, container: vol.pvcName ?? vol.name, resource: "PVC",
            kind: "danger", message: `PVC "${vol.pvcName}" at ${Math.round(pct * 100)}% capacity`,
            current: fmtSuggested(cap, false), suggested: fmtSuggested(Math.ceil(cap * 1.5), false) });
        } else if (pct >= 0.75) {
          results.push({ deployment: depName, container: vol.pvcName ?? vol.name, resource: "PVC",
            kind: "warning", message: `PVC "${vol.pvcName}" at ${Math.round(pct * 100)}% capacity`,
            current: fmtSuggested(cap, false), suggested: fmtSuggested(Math.ceil(cap * 1.5), false) });
        }
      }
    }

    if (vol.type === "emptyDir" && !vol.sizeLimit) {
      results.push({ deployment: depName, container: vol.name, resource: "EmptyDir",
        kind: "warning", message: `EmptyDir "${vol.name}" has no sizeLimit`,
        current: "unlimited", suggested: fmtSuggested(Math.ceil(use * 2), false) });
    }
  }
  return results;
}

export function computeSuggestions(deployments: DeploymentDetail[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const dep of deployments) {
    for (const pod of dep.pods ?? []) {
      for (const c of pod.containers) {
        out.push(...analyzeCpuMem(c, dep.name));
        out.push(...analyzeEphemeral(c, dep.name));
      }
      out.push(...analyzeVolumes(pod.volumes ?? [], dep.name));
    }
  }
  const order: Record<SuggestionKind, number> = { danger: 0, warning: 1, overkill: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}

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
