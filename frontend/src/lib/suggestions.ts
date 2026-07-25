import { fmtRawValue } from "./api";
import type { DataPoint, DeploymentDetail, PodDetail, ContainerResources, ResourceValue, VolumeDetail, ContainerHistory, NodeOverview, QOSClass } from "./api";

export type SuggestionKind = "danger" | "warning" | "overkill";

export interface Suggestion {
  deployment: string;
  /** Workload kind ("Deployment" | "StatefulSet" | "CronJob") — drives the kubectl target. */
  workloadKind: string;
  namespace: string;
  /** Representative pod: scroll target and search matching. Suggestions are workload-level. */
  pod: string;
  /** Number of replicas this suggestion aggregates. */
  podCount: number;
  container: string;
  resource: string;
  kind: SuggestionKind;
  action: string;
  message: string;
  current: string;
  suggested: string;
  suggestedRaw: number;
  /** When set, the suggestion changes request AND limit together to preserve Guaranteed QoS. */
  appliesToBoth?: boolean;
  /** Non-blocking caveats shown under the suggestion (QoS change, bursty usage, restarts). */
  warnings?: string[];
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

/**
 * Linear regression on time-series points (mirrors PromQL predict_linear).
 * Returns seconds until the value reaches `threshold` based on the observed trend,
 * or null if the trend is flat/decreasing, data is insufficient, or threshold is already exceeded.
 * Uses up to the last 60 points to focus on recent behaviour.
 */
function secondsToThreshold(points: DataPoint[], threshold: number): number | null {
  if (points.length < 5) return null;
  const recent = points.slice(-Math.min(points.length, 60));
  const n = recent.length;
  // Re-base timestamps on the first point: raw unix seconds squared overflow float64
  // precision in the sums below and skew the slope (AUDIT B-2).
  const t0 = recent[0].t;
  let sumT = 0, sumV = 0, sumTT = 0, sumTV = 0;
  for (const p of recent) {
    const t = p.t - t0;
    sumT += t; sumV += p.v;
    sumTT += t * t; sumTV += t * p.v;
  }
  const denom = n * sumTT - sumT * sumT;
  if (denom === 0) return null;
  const slope = (n * sumTV - sumT * sumV) / denom;
  if (slope <= 0) return null;
  const intercept = (sumV - slope * sumT) / n;
  const lastT = recent[recent.length - 1].t - t0;
  const predictedT = (threshold - intercept) / slope;
  if (predictedT <= lastT) return null;
  return predictedT - lastT;
}

/** Extracts the numeric value from a ResourceValue (millicores for CPU, bytes for memory). */
function val(rv: ResourceValue | undefined, isCPU: boolean): number {
  if (!rv) return 0;
  return isCPU ? (rv.millicores ?? 0) : (rv.bytes ?? 0);
}

const MIB = 1024 * 1024;

// Standard binary memory steps (MiB): powers of 2 plus common thirds (192, 384, 768…).
// Rounded suggestions always land on one of these values, giving at most ~28% overhead.
const MEMORY_STEPS_B = [
  64, 128, 192, 256, 384, 512, 768, 1024, 1536, 2048,
  3072, 4096, 6144, 8192, 12288, 16384, 24576, 32768,
].map(m => m * MIB);

/**
 * Rounds a raw resource value up to the nearest "clean" step.
 *   CPU  : nearest multiple of 50m (≤1000m) or 250m (>1000m).
 *   Memory/storage: nearest standard binary step (64Mi … 32Gi).
 */
export function roundResource(raw: number, isCPU: boolean): number {
  if (raw <= 0) return 0;
  if (isCPU) {
    return raw <= 1000
      ? Math.ceil(raw / 50) * 50
      : Math.ceil(raw / 250) * 250;
  }
  for (const step of MEMORY_STEPS_B) {
    if (step >= raw) return step;
  }
  // Beyond table: round up to next 32GiB block
  const last = MEMORY_STEPS_B[MEMORY_STEPS_B.length - 1];
  return Math.ceil(raw / last) * last;
}

/** Formats a raw resource value as a kubectl-compatible quantity string (e.g. "500m", "512Mi", "2Gi"). */
function fmtKubectl(raw: number, isCPU: boolean): string {
  if (isCPU) return `${Math.round(raw)}m`;
  const mib = Math.round(raw / MIB);
  return mib % 1024 === 0 ? `${mib / 1024}Gi` : `${mib}Mi`;
}

/** Maximum allocatable CPU and memory across all Ready nodes — used to cap suggestions. */
export interface NodeCapacity {
  maxCpuMillicores: number;
  maxMemoryBytes: number;
  readyCpuMillicores: number[];
  readyMemoryBytes: number[];
}

/** Returns the maximum allocatable CPU and memory across all Ready nodes, plus per-node arrays for fit checks. */
export function maxNodeCapacity(nodes: NodeOverview[]): NodeCapacity {
  const readyCpuMillicores: number[] = [];
  const readyMemoryBytes: number[] = [];
  for (const n of nodes) {
    if (n.status === "Ready") {
      readyCpuMillicores.push(n.allocatable.cpu.millicores ?? 0);
      readyMemoryBytes.push(n.allocatable.memory.bytes ?? 0);
    }
  }
  const maxCpu = readyCpuMillicores.length > 0 ? Math.max(...readyCpuMillicores) : 0;
  const maxMem = readyMemoryBytes.length > 0 ? Math.max(...readyMemoryBytes) : 0;
  return { maxCpuMillicores: maxCpu, maxMemoryBytes: maxMem, readyCpuMillicores, readyMemoryBytes };
}

/** Returns "· fits on N/M nodes" suffix when the value doesn't fit on all nodes, or "" otherwise. */
function nodesFitting(value: number, nodeLimits: number[]): string {
  if (nodeLimits.length <= 1) return "";
  const fits = nodeLimits.filter(cap => cap >= value).length;
  if (fits === nodeLimits.length) return "";
  return ` · fits on ${fits}/${nodeLimits.length} nodes`;
}

/** Applies rounding and returns both the display string and the raw rounded value. */
function suggest(raw: number, isCPU: boolean): { suggested: string; suggestedRaw: number } {
  const rounded = roundResource(raw, isCPU);
  return { suggested: fmtRawValue(rounded, isCPU), suggestedRaw: rounded };
}

/** Like suggest(), but caps the result at node allocatable and annotates how many nodes can fit the value. */
function suggestCapped(raw: number, isCPU: boolean, nodeCap?: NodeCapacity): { suggested: string; suggestedRaw: number; capped: boolean; nodeFitSuffix: string } {
  const cap = isCPU ? (nodeCap?.maxCpuMillicores ?? 0) : (nodeCap?.maxMemoryBytes ?? 0);
  const nodeValues = isCPU ? (nodeCap?.readyCpuMillicores ?? []) : (nodeCap?.readyMemoryBytes ?? []);
  const rounded = roundResource(raw, isCPU);
  if (cap > 0 && rounded > cap) {
    return { suggested: fmtRawValue(cap, isCPU), suggestedRaw: cap, capped: true, nodeFitSuffix: nodesFitting(cap, nodeValues) };
  }
  return { suggested: fmtRawValue(rounded, isCPU), suggestedRaw: rounded, capped: false, nodeFitSuffix: nodesFitting(rounded, nodeValues) };
}

// --- Aggregation across replicas -------------------------------------------------

/**
 * A container's usage across every replica of a workload.
 * Requests/limits come from the pod template and are identical across replicas, so a
 * single representative spec is kept; usage is pooled so one workload yields one
 * suggestion instead of one per pod.
 */
interface ContainerAggregate {
  name: string;
  spec: ContainerResources;
  podNames: string[];
  /** True when any replica was OOMKilled (current or previous run). */
  oomKilled: boolean;
  /** Highest restart count across replicas. */
  maxRestarts: number;
  qos?: QOSClass;
  volumes: VolumeDetail[];
}

/** Pooled usage statistics for one resource (CPU or memory) of one container. */
interface UsageStats {
  hasHistory: boolean;
  p95: number;
  mean: number;
  max: number;
  /** Samples per replica — drives the confidence label (time coverage, not replica count). */
  samplesPerReplica: number;
  /** Per-replica time series, used for trend prediction (pooling would interleave timestamps). */
  series: DataPoint[][];
  /** Per-replica mean usage, used to surface replicas that deviate from their peers. */
  perReplicaMean: number[];
}

/** Groups a workload's pods into one aggregate per container name. */
function aggregateContainers(pods: PodDetail[]): ContainerAggregate[] {
  const byName = new Map<string, ContainerAggregate>();
  for (const pod of pods) {
    for (const c of pod.containers) {
      let agg = byName.get(c.name);
      if (!agg) {
        agg = { name: c.name, spec: c, podNames: [], oomKilled: false, maxRestarts: 0, qos: pod.qosClass, volumes: [] };
        byName.set(c.name, agg);
      }
      agg.podNames.push(pod.name);
      if (c.oomKilled) agg.oomKilled = true;
      agg.maxRestarts = Math.max(agg.maxRestarts, c.restartCount ?? 0);
    }
  }
  return [...byName.values()];
}

/**
 * Pools usage for one container/resource across every replica.
 * Returns null when no replica reports usage — matching the previous per-pod behaviour
 * of emitting nothing at all for containers metrics-server doesn't know about.
 */
function usageStats(
  pods: PodDetail[],
  containerName: string,
  isCPU: boolean,
  histMap?: HistoryMap,
): UsageStats | null {
  const pooled: number[] = [];
  const series: DataPoint[][] = [];
  const perReplicaMean: number[] = [];
  const snapshots: number[] = [];
  let replicasWithHistory = 0;

  for (const pod of pods) {
    const c = pod.containers.find((x) => x.name === containerName);
    if (!c?.usage) continue;
    const snap = val(isCPU ? c.usage.cpu : c.usage.memory, isCPU);
    if (snap > 0) snapshots.push(snap);

    const hist = histMap?.get(`${pod.name}/${containerName}`);
    const points = hist ? (isCPU ? hist.cpu : hist.memory) : [];
    if (points.length >= 2) {
      replicasWithHistory++;
      series.push(points);
      const values = points.map((p) => p.v);
      pooled.push(...values);
      perReplicaMean.push(mean(values));
    } else if (snap > 0) {
      perReplicaMean.push(snap);
    }
  }

  if (snapshots.length === 0 && pooled.length === 0) return null;

  const hasHistory = pooled.length >= 2;
  const values = hasHistory ? pooled : snapshots;
  if (values.length === 0) return null;

  return {
    hasHistory,
    p95: hasHistory ? percentile95(values) : Math.max(...values),
    mean: mean(values),
    max: Math.max(...values),
    samplesPerReplica: hasHistory ? Math.round(pooled.length / Math.max(1, replicasWithHistory)) : 1,
    series,
    perReplicaMean,
  };
}

// --- Guard rails -----------------------------------------------------------------

/** Peak-to-P95 ratio above which a workload is treated as bursty and reductions are based on the peak. */
const BURST_RATIO = 5;
/** Restart count above which usage data is considered unreliable and all reductions are suppressed. */
const CRASHLOOP_RESTARTS = 3;

/** Returns the peak/P95 ratio, or 0 when it cannot be computed. */
function burstRatio(st: UsageStats): number {
  if (!st.hasHistory || st.p95 <= 0) return 0;
  return st.max / st.p95;
}

/** Returns a "replica usage varies N×" warning when replicas of the same workload diverge. */
function replicaSpreadWarning(st: UsageStats, isCPU: boolean): string | null {
  if (st.perReplicaMean.length < 2) return null;
  const lo = Math.min(...st.perReplicaMean);
  const hi = Math.max(...st.perReplicaMean);
  if (lo <= 0 || hi / lo < 2) return null;
  return `Replica usage varies ${(hi / lo).toFixed(1)}× (${fmtRawValue(lo, isCPU)} – ${fmtRawValue(hi, isCPU)}) — the workload may be unevenly loaded`;
}

// --- Analysis --------------------------------------------------------------------

interface AnalysisContext {
  deployment: string;
  workloadKind: string;
  namespace: string;
  pod: string;
  podCount: number;
  container: string;
}

/**
 * Generates CPU and memory suggestions for a container, aggregated across all replicas.
 *
 * Guard rails applied before any reduction is emitted:
 *   - OOMKilled memory  → reductions suppressed, an "Increase limit" danger is raised instead.
 *   - CrashLooping      → all reductions suppressed (usage of a restarting container is meaningless).
 *   - Bursty (peak ≥5×) → reductions sized on the observed peak, dropped when they save <10%.
 *   - Guaranteed QoS    → request and limit are moved together so the pod keeps its QoS class.
 */
function analyzeCpuMem(
  agg: ContainerAggregate,
  pods: PodDetail[],
  ctx: Omit<AnalysisContext, "container">,
  histMap?: HistoryMap,
  nodeCap?: NodeCapacity,
): Suggestion[] {
  const results: Suggestion[] = [];
  const c = agg.spec;

  for (const isCPU of [true, false]) {
    const label = isCPU ? "CPU" : "Memory";
    const req = val(isCPU ? c.requests.cpu : c.requests.memory, isCPU);
    const lim = val(isCPU ? c.limits.cpu : c.limits.memory, isCPU);

    const st = usageStats(pods, agg.name, isCPU, histMap);
    if (!st) continue;

    const p95Use = st.p95;
    const meanUse = st.mean;
    const source = st.hasHistory ? "avg" : "current";
    const confidence = !st.hasHistory ? ""
      : st.samplesPerReplica >= 400 ? " · high confidence"
      : st.samplesPerReplica >= 60 ? " · medium confidence"
      : " · low confidence";

    const base = { ...ctx, container: agg.name };

    // Guaranteed QoS holds only while request === limit for this resource; moving one
    // side alone silently downgrades the pod to Burstable (higher eviction priority).
    const isGuaranteedPair = agg.qos === "Guaranteed" && req > 0 && req === lim;

    // Reductions are unsafe when the container is OOMKilled (memory only) or crashlooping:
    // a container that keeps restarting reports a low RSS that understates what it needs.
    const crashLooping = agg.maxRestarts >= CRASHLOOP_RESTARTS;
    const oomBlocked = !isCPU && agg.oomKilled;
    const reductionsBlocked = crashLooping || oomBlocked;

    const burst = burstRatio(st);
    const bursty = burst >= BURST_RATIO;
    const burstNote = bursty ? ` · bursty (peak ${burst.toFixed(1)}× P95)` : "";

    const commonWarnings: string[] = [];
    const spread = replicaSpreadWarning(st, isCPU);
    if (spread) commonWarnings.push(spread);
    if (agg.maxRestarts > 0) {
      commonWarnings.push(`${agg.maxRestarts} restart${agg.maxRestarts > 1 ? "s" : ""} observed${agg.oomKilled ? " (OOMKilled)" : ""}`);
    }

    const withWarnings = (extra: string[] = []): string[] | undefined => {
      const all = [...commonWarnings, ...extra];
      return all.length > 0 ? all : undefined;
    };

    // --- OOMKilled: the strongest signal a memory limit is too low ------------------
    if (oomBlocked) {
      if (lim > 0) {
        const { capped, nodeFitSuffix, ...s } = suggestCapped(Math.max(lim, st.max) * 1.5, isCPU, nodeCap);
        if (capped && s.suggestedRaw <= lim) {
          results.push({
            ...base, resource: label, kind: "danger",
            action: "Migrate to larger node",
            message: "Container was OOMKilled — node capacity too small to increase the memory limit",
            current: fmtRawValue(lim, isCPU), suggested: fmtRawValue(lim, isCPU), suggestedRaw: lim,
            warnings: withWarnings(),
          });
        } else {
          results.push({
            ...base, resource: label, kind: "danger",
            action: "Increase limit",
            message: `Container was OOMKilled — memory limit is too low${capped ? " · capped to node capacity" : ""}${nodeFitSuffix}`,
            current: fmtRawValue(lim, isCPU), ...s,
            appliesToBoth: isGuaranteedPair || undefined,
            warnings: withWarnings(),
          });
        }
      } else {
        const { capped, nodeFitSuffix, ...s } = suggestCapped(st.max * 2, isCPU, nodeCap);
        results.push({
          ...base, resource: `${label} — no limit`, kind: "danger",
          action: "Set limit",
          message: `Container was OOMKilled with no memory limit — the node ran out of memory${capped ? " · capped to node capacity" : ""}${nodeFitSuffix}`,
          current: "unlimited", ...s,
          warnings: withWarnings(),
        });
      }
    }

    // No request defined — flag it
    if (req === 0) {
      const { capped, nodeFitSuffix, ...s } = suggestCapped((meanUse > 0 ? meanUse : st.max) * 1.3, isCPU, nodeCap);
      results.push({ ...base, resource: `${label} — no request`, kind: "warning",
        action: "Set request",
        message: `No ${label} request set — scheduler cannot guarantee resources${capped ? " · capped to node capacity" : ""}${nodeFitSuffix}`,
        current: "none", ...s, warnings: withWarnings() });
    }
    // No limit defined — flag it (skipped when the OOM branch above already raised it)
    if (lim === 0 && !oomBlocked) {
      const { capped, nodeFitSuffix, ...s } = suggestCapped((p95Use > 0 ? p95Use : st.max * 2) * 1.5, isCPU, nodeCap);
      results.push({ ...base, resource: `${label} — no limit`, kind: "warning",
        action: "Set limit",
        message: `No ${label} limit set — container can consume unbounded ${label.toLowerCase()}${capped ? " · capped to node capacity" : ""}${nodeFitSuffix}`,
        current: "unlimited", ...s, warnings: withWarnings() });
    }

    if (lim > 0 && !oomBlocked) {
      const pct = p95Use / lim;
      if (pct >= 0.70) {
        const kind: SuggestionKind = pct >= 0.90 ? "danger" : "warning";
        const { capped, nodeFitSuffix, ...s } = suggestCapped(p95Use * 1.4, isCPU, nodeCap);
        if (capped && s.suggestedRaw <= lim) {
          results.push({ ...base, resource: label, kind: "danger",
            action: "Migrate to larger node",
            message: `${label} P95 usage at ${Math.round(pct * 100)}% of limit — node capacity too small to increase limit${confidence}`,
            current: fmtRawValue(lim, isCPU), suggested: fmtRawValue(lim, isCPU), suggestedRaw: lim,
            warnings: withWarnings() });
        } else {
          results.push({ ...base, resource: label, kind,
            action: "Increase limit",
            message: `${label} P95 usage at ${Math.round(pct * 100)}% of limit${confidence}${capped ? " · capped to node capacity" : ""}${nodeFitSuffix}`,
            current: fmtRawValue(lim, isCPU), ...s,
            appliesToBoth: isGuaranteedPair || undefined,
            warnings: withWarnings() });
        }
      } else if (st.hasHistory) {
        // Trend-based: predict when usage will exceed the limit (only when P95 hasn't already
        // flagged it). Each replica is regressed separately — pooling would interleave
        // timestamps — and the most urgent replica wins.
        let soonest: number | null = null;
        for (const points of st.series) {
          const secs = secondsToThreshold(points, lim);
          if (secs !== null && (soonest === null || secs < soonest)) soonest = secs;
        }
        if (soonest !== null && soonest < 24 * 3600) {
          const hours = soonest / 3600;
          const trendKind: SuggestionKind = hours < 4 ? "danger" : "warning";
          const timeStr = hours < 1 ? `${Math.round(soonest / 60)}m` : `${hours.toFixed(1)}h`;
          const { capped, nodeFitSuffix, ...s } = suggestCapped(lim * 1.5, isCPU, nodeCap);
          if (capped && s.suggestedRaw <= lim) {
            results.push({ ...base, resource: label, kind: "danger",
              action: "Migrate to larger node",
              message: `${label} trending to exceed limit in ~${timeStr} — node capacity too small to increase limit (linear trend${confidence.replace(" · ", ", ")})`,
              current: fmtRawValue(lim, isCPU), suggested: fmtRawValue(lim, isCPU), suggestedRaw: lim,
              warnings: withWarnings() });
          } else {
            results.push({ ...base, resource: label, kind: trendKind,
              action: "Increase limit",
              message: `${label} trending to exceed limit in ~${timeStr} (linear trend${confidence.replace(" · ", ", ")})${capped ? " · capped to node capacity" : ""}${nodeFitSuffix}`,
              current: fmtRawValue(lim, isCPU), ...s,
              appliesToBoth: isGuaranteedPair || undefined,
              warnings: withWarnings() });
          }
        }
      }
    }

    // --- Reductions ----------------------------------------------------------------
    // Bursty workloads are sized on the observed peak, not the mean: a JVM that needs
    // 2 CPU for 60s at startup and 100m afterwards must not be told to request 130m.
    const reductionBasis = bursty ? st.max : meanUse;

    const requestOverkill = req > 0 && meanUse / req <= 0.35;
    if (requestOverkill && !reductionsBlocked) {
      const target = roundResource(reductionBasis * 1.3, isCPU);
      // Drop the suggestion when the peak-based value saves less than 10% — nothing to gain.
      if (!bursty || target < req * 0.9) {
        results.push({ ...base, resource: label, kind: "overkill",
          action: isGuaranteedPair ? "Reduce request + limit" : "Reduce request",
          message: `${label} ${source} request is ${(req / meanUse).toFixed(1)}× actual usage${confidence}${burstNote}`,
          current: fmtRawValue(req, isCPU), suggested: fmtRawValue(target, isCPU), suggestedRaw: target,
          appliesToBoth: isGuaranteedPair || undefined,
          warnings: withWarnings(isGuaranteedPair ? ["Request and limit are moved together to keep the pod in the Guaranteed QoS class"] : []) });
      }
    }

    // Limit over-provisioned: limit is more than 3× P95 usage.
    // Skipped for Guaranteed pairs — the "Reduce request + limit" suggestion above already
    // covers both sides, and emitting a second one would contradict it.
    if (lim > 0 && p95Use > 0 && lim / p95Use >= 3 && !reductionsBlocked && !(isGuaranteedPair && requestOverkill)) {
      const target = roundResource((bursty ? st.max * 1.15 : p95Use * 1.5), isCPU);
      if (!bursty || target < lim * 0.9) {
        results.push({ ...base, resource: label, kind: "overkill",
          action: isGuaranteedPair ? "Reduce request + limit" : "Reduce limit",
          message: `${label} limit is ${(lim / p95Use).toFixed(1)}× P95 usage${confidence}${burstNote}`,
          current: fmtRawValue(lim, isCPU), suggested: fmtRawValue(target, isCPU), suggestedRaw: target,
          appliesToBoth: isGuaranteedPair || undefined,
          warnings: withWarnings(isGuaranteedPair ? ["Request and limit are moved together to keep the pod in the Guaranteed QoS class"] : []) });
      }
    }

    // Request too low: P95 usage consistently exceeds request (only when not already flagged as overkill)
    if (req > 0 && !requestOverkill && p95Use > req * 1.1) {
      const ratio = p95Use / req;
      const kind: SuggestionKind = ratio >= 2 ? "danger" : "warning";
      const { capped, nodeFitSuffix, ...s } = suggestCapped(p95Use * 1.3, isCPU, nodeCap);
      if (capped && s.suggestedRaw <= req) {
        results.push({ ...base, resource: label, kind: "danger",
          action: "Migrate to larger node",
          message: `${label} ${source} usage is ${ratio.toFixed(1)}× the request — node capacity too small to increase request${confidence}`,
          current: fmtRawValue(req, isCPU), suggested: fmtRawValue(req, isCPU), suggestedRaw: req,
          warnings: withWarnings() });
      } else {
        results.push({ ...base, resource: label, kind,
          action: isGuaranteedPair ? "Increase request + limit" : "Increase request",
          message: `${label} ${source} usage is ${ratio.toFixed(1)}× the request — pod may be throttled or evicted${confidence}${capped ? " · capped to node capacity" : ""}${nodeFitSuffix}`,
          current: fmtRawValue(req, isCPU), ...s,
          appliesToBoth: isGuaranteedPair || undefined,
          warnings: withWarnings(isGuaranteedPair ? ["Request and limit are moved together to keep the pod in the Guaranteed QoS class"] : []) });
      }
    }

    // Coherence: when both "Reduce request" and "Reduce limit" exist for this container/resource,
    // ensure suggested limit > suggested request (K8s rejects limit < request).
    // This can happen when both round to the same binary memory step (e.g. both → 8Gi).
    const reqSug = results.find(r => r.action === "Reduce request" && r.resource === label && r.container === agg.name);
    const limSug = results.find(r => r.action === "Reduce limit" && r.resource === label && r.container === agg.name);
    if (reqSug && limSug && limSug.suggestedRaw <= reqSug.suggestedRaw) {
      const nextStep = roundResource(reqSug.suggestedRaw + 1, isCPU);
      const hardCap = isCPU ? (nodeCap?.maxCpuMillicores ?? 0) : (nodeCap?.maxMemoryBytes ?? 0);
      const effective = hardCap > 0 && nextStep > hardCap ? hardCap : nextStep;
      limSug.suggestedRaw = effective;
      limSug.suggested = fmtRawValue(effective, isCPU);
    }
  }
  return results;
}

/** Generates ephemeral storage suggestions for a container, aggregated across replicas. */
function analyzeEphemeral(agg: ContainerAggregate, pods: PodDetail[], ctx: Omit<AnalysisContext, "container">): Suggestion[] {
  // Ephemeral usage is per-replica; the worst replica drives the suggestion.
  let use = 0;
  let lim = 0;
  for (const pod of pods) {
    const eph = pod.containers.find((x) => x.name === agg.name)?.ephemeralStorage;
    if (!eph?.usage) continue;
    use = Math.max(use, eph.usage.bytes ?? 0);
    lim = Math.max(lim, eph.limit?.bytes ?? 0);
  }
  if (use === 0) return [];

  const results: Suggestion[] = [];
  const base = { ...ctx, container: agg.name };

  if (lim === 0) {
    results.push({ ...base, resource: "Ephemeral — no limit", kind: "warning",
      action: "Set limit",
      message: "No ephemeral-storage limit set",
      current: "unlimited", ...suggest(use * 2, false) });
  } else {
    const pct = use / lim;
    if (pct >= 0.90) {
      results.push({ ...base, resource: "Ephemeral", kind: "danger",
        action: "Increase limit",
        message: `Ephemeral usage at ${Math.round(pct * 100)}% of limit`,
        current: fmtRawValue(lim, false), ...suggest(use * 1.5, false) });
    } else if (pct >= 0.70) {
      results.push({ ...base, resource: "Ephemeral", kind: "warning",
        action: "Increase limit",
        message: `Ephemeral usage at ${Math.round(pct * 100)}% of limit`,
        current: fmtRawValue(lim, false), ...suggest(use * 1.5, false) });
    }
  }
  return results;
}

/**
 * Generates volume suggestions: PVC near capacity, emptyDir without sizeLimit.
 * PVCs stay per-pod — a StatefulSet's volumeClaimTemplates create one distinct
 * physical volume per replica, so they must each be reported. EmptyDirs come from
 * the pod template and are deduplicated by volume name.
 */
function analyzeVolumes(pods: PodDetail[], ctx: Omit<AnalysisContext, "container" | "pod" | "podCount">): Suggestion[] {
  const results: Suggestion[] = [];
  const seenEmptyDir = new Set<string>();

  for (const pod of pods) {
    for (const vol of pod.volumes ?? []) {
      const use = vol.usage?.bytes ?? 0;
      if (use === 0) continue;

      if (vol.type === "pvc") {
        const cap = vol.capacity?.bytes ?? 0;
        if (cap > 0) {
          const pct = use / cap;
          const base = { ...ctx, pod: pod.name, podCount: 1, container: vol.pvcName ?? vol.name };
          if (pct >= 0.90) {
            results.push({ ...base, resource: "PVC", kind: "danger", action: "Expand PVC",
              message: `PVC "${vol.pvcName}" at ${Math.round(pct * 100)}% capacity`,
              current: fmtRawValue(cap, false), ...suggest(cap * 1.5, false) });
          } else if (pct >= 0.75) {
            results.push({ ...base, resource: "PVC", kind: "warning", action: "Expand PVC",
              message: `PVC "${vol.pvcName}" at ${Math.round(pct * 100)}% capacity`,
              current: fmtRawValue(cap, false), ...suggest(cap * 1.5, false) });
          }
        }
      }

      if (vol.type === "emptyDir" && !vol.sizeLimit && !seenEmptyDir.has(vol.name)) {
        seenEmptyDir.add(vol.name);
        results.push({ ...ctx, pod: pod.name, podCount: pods.length, container: vol.name, resource: "EmptyDir",
          kind: "warning", action: "Set sizeLimit",
          message: `EmptyDir "${vol.name}" has no sizeLimit`,
          current: "unlimited", ...suggest(use * 2, false) });
      }
    }
  }
  return results;
}

/**
 * Computes all suggestions across all workloads, sorted by severity (danger → warning → overkill).
 *
 * Suggestions are workload-level, not pod-level: requests and limits are set on the pod
 * template, so a Deployment with 20 replicas produces one suggestion per container/resource,
 * with usage pooled across every replica — not 20 identical rows.
 *
 * When history is provided, suggestions are weighted with Prometheus P95/mean data.
 * When nodes is provided, "increase" suggestions are capped at the maximum node allocatable capacity.
 */
export function computeSuggestions(deployments: DeploymentDetail[], history?: ContainerHistory[], nodes?: NodeOverview[]): Suggestion[] {
  const histMap = history && history.length > 0 ? buildHistoryMap(history) : undefined;
  const nodeCap = nodes && nodes.length > 0 ? maxNodeCapacity(nodes) : undefined;
  const out: Suggestion[] = [];

  for (const dep of deployments) {
    const pods = dep.pods ?? [];
    if (pods.length === 0) continue;

    const ctx = {
      deployment: dep.name,
      workloadKind: dep.kind,
      namespace: dep.namespace,
      pod: pods[0].name,
      podCount: pods.length,
    };

    for (const agg of aggregateContainers(pods)) {
      out.push(...analyzeCpuMem(agg, pods, ctx, histMap, nodeCap));
      out.push(...analyzeEphemeral(agg, pods, ctx));
    }
    out.push(...analyzeVolumes(pods, { deployment: dep.name, workloadKind: dep.kind, namespace: dep.namespace }));
  }

  const order: Record<SuggestionKind, number> = { danger: 0, warning: 1, overkill: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}

/** Maps a workload kind to the `kubectl set resources` target prefix, or null when unsupported. */
function kubectlTarget(kind: string, name: string): string | null {
  switch (kind) {
    case "Deployment": return `deployment/${name}`;
    case "StatefulSet": return `statefulset/${name}`;
    case "DaemonSet": return `daemonset/${name}`;
    // CronJob pod templates are nested under spec.jobTemplate — `kubectl set resources`
    // cannot address them, so no command is offered rather than a wrong one.
    default: return null;
  }
}

/**
 * Generates a kubectl command for a suggestion, or null when the change cannot be
 * expressed as a `kubectl set resources` call (PVC, EmptyDir, CronJob, node-capacity-blocked).
 */
export function toKubectlCmd(s: Suggestion): string | null {
  if (s.action === "Migrate to larger node") return null;
  let k8sResource: string;
  if (s.resource.startsWith("CPU")) k8sResource = "cpu";
  else if (s.resource.startsWith("Memory")) k8sResource = "memory";
  else if (s.resource.startsWith("Ephemeral")) k8sResource = "ephemeral-storage";
  else return null;

  const target = kubectlTarget(s.workloadKind, s.deployment);
  if (!target) return null;

  const isCPU = k8sResource === "cpu";
  const value = `${k8sResource}=${fmtKubectl(s.suggestedRaw, isCPU)}`;
  // Guaranteed pods must keep request === limit, so both flags are set together.
  const flags = s.appliesToBoth
    ? `--requests=${value} --limits=${value}`
    : `${s.action.toLowerCase().includes("request") ? "--requests" : "--limits"}=${value}`;

  return `kubectl set resources ${target} -c ${s.container} ${flags} -n ${s.namespace}`;
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
