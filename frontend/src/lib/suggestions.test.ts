import { describe, it, expect } from "vitest";
import {
  resourceStatus,
  storageStatus,
  buildHistoryMap,
  computeSuggestions,
  maxNodeCapacity,
  toKubectlCmd,
} from "./suggestions";
import type { ResourceValue, ContainerResources, DeploymentDetail, PodDetail, ContainerHistory, NodeOverview, NodeResources, QOSClass } from "./api";

// --- helpers ---

function cpu(millicores: number): ResourceValue {
  return { raw: `${millicores}m`, millicores };
}

function mem(bytes: number): ResourceValue {
  return { raw: `${bytes}`, bytes };
}

function container(
  name: string,
  opts: {
    cpuReq?: number; memReq?: number;
    cpuLim?: number; memLim?: number;
    cpuUse?: number; memUse?: number;
    oomKilled?: boolean; restartCount?: number;
  } = {},
): ContainerResources {
  const { cpuReq = 0, memReq = 0, cpuLim = 0, memLim = 0, cpuUse, memUse, oomKilled, restartCount } = opts;
  return {
    name,
    requests: { cpu: cpu(cpuReq), memory: mem(memReq) },
    limits:   { cpu: cpu(cpuLim), memory: mem(memLim) },
    usage: cpuUse !== undefined || memUse !== undefined
      ? { cpu: cpu(cpuUse ?? 0), memory: mem(memUse ?? 0) }
      : undefined,
    oomKilled,
    restartCount,
  };
}

function deployment(name: string, containers: ContainerResources[]): DeploymentDetail {
  return {
    kind: "Deployment", name, namespace: "default",
    replicas: 1, readyReplicas: 1, availableReplicas: 1,
    pods: [{ name: "pod-1", phase: "Running", containers }],
  };
}

/** Builds a workload from explicit pods — for replica aggregation, QoS and kind tests. */
function workload(
  name: string,
  pods: PodDetail[],
  opts: { kind?: string; qosClass?: QOSClass } = {},
): DeploymentDetail {
  return {
    kind: opts.kind ?? "Deployment", name, namespace: "default",
    replicas: pods.length, readyReplicas: pods.length, availableReplicas: pods.length,
    pods: opts.qosClass ? pods.map((p) => ({ ...p, qosClass: opts.qosClass })) : pods,
  };
}

function pod(name: string, containers: ContainerResources[]): PodDetail {
  return { name, phase: "Running", containers };
}

/** N identical replicas of the same container spec. */
function replicas(n: number, c: ContainerResources): PodDetail[] {
  return Array.from({ length: n }, (_, i) => pod(`pod-${i + 1}`, [{ ...c }]));
}

const MiB = 1024 * 1024;

function nodeResources(cpuMillicores: number, memBytes: number): NodeResources {
  return { cpu: cpu(cpuMillicores), memory: mem(memBytes) };
}

function node(cpuAllocMillicores: number, memAllocBytes: number, status: "Ready" | "NotReady" = "Ready"): NodeOverview {
  const res = nodeResources(cpuAllocMillicores, memAllocBytes);
  return {
    name: "node-1", status, roles: [],
    capacity: res, allocatable: res, requested: nodeResources(0, 0), limited: nodeResources(0, 0),
    podCount: 0, maxPods: 110,
    diskPressure: false, memoryPressure: false, pidPressure: false,
  };
}

// --- resourceStatus ---

describe("resourceStatus", () => {
  it("returns none when no usage", () => {
    expect(resourceStatus(undefined, cpu(100), cpu(200), true)).toBe("none");
  });

  it("returns none when usage is 0", () => {
    expect(resourceStatus(cpu(0), cpu(100), cpu(200), true)).toBe("none");
  });

  it("returns danger at 90%+ of limit", () => {
    expect(resourceStatus(cpu(900), cpu(500), cpu(1000), true)).toBe("danger");
  });

  it("returns danger at exactly 100% of limit", () => {
    expect(resourceStatus(cpu(1000), cpu(500), cpu(1000), true)).toBe("danger");
  });

  it("returns warning at 70–89% of limit", () => {
    expect(resourceStatus(cpu(750), cpu(500), cpu(1000), true)).toBe("warning");
  });

  it("returns overkill when usage ≤ 35% of request", () => {
    expect(resourceStatus(cpu(30), cpu(100), cpu(0), true)).toBe("overkill");
  });

  it("returns overkill at exactly 35% of request", () => {
    expect(resourceStatus(cpu(35), cpu(100), cpu(0), true)).toBe("overkill");
  });

  it("returns healthy in normal range", () => {
    expect(resourceStatus(cpu(400), cpu(500), cpu(1000), true)).toBe("healthy");
  });

  it("works for memory (bytes)", () => {
    const MiB = 1024 * 1024;
    expect(resourceStatus(mem(900 * MiB), mem(500 * MiB), mem(1000 * MiB), false)).toBe("danger");
  });
});

// --- storageStatus ---

describe("storageStatus", () => {
  it("returns none when no usage", () => {
    expect(storageStatus(undefined, mem(100), true)).toBe("none");
  });

  it("returns none when usage is 0", () => {
    expect(storageStatus(mem(0), mem(100), true)).toBe("none");
  });

  it("returns warning when no limit set", () => {
    expect(storageStatus(mem(500), undefined, false)).toBe("warning");
  });

  it("returns danger at 90%+ of capacity", () => {
    expect(storageStatus(mem(950), mem(1000), true)).toBe("danger");
  });

  it("returns warning at 75–89% of capacity", () => {
    expect(storageStatus(mem(800), mem(1000), true)).toBe("warning");
  });

  it("returns healthy below 75%", () => {
    expect(storageStatus(mem(500), mem(1000), true)).toBe("healthy");
  });

  it("returns none when capacity is 0", () => {
    expect(storageStatus(mem(100), mem(0), true)).toBe("none");
  });
});

// --- buildHistoryMap ---

describe("buildHistoryMap", () => {
  it("indexes by pod/container key", () => {
    const h: ContainerHistory = { pod: "app-1", container: "main", cpu: [], memory: [] };
    const map = buildHistoryMap([h]);
    expect(map.get("app-1/main")).toBe(h);
  });

  it("returns empty map for empty input", () => {
    expect(buildHistoryMap([]).size).toBe(0);
  });

  it("handles multiple entries", () => {
    const h1: ContainerHistory = { pod: "p1", container: "c1", cpu: [], memory: [] };
    const h2: ContainerHistory = { pod: "p1", container: "c2", cpu: [], memory: [] };
    const map = buildHistoryMap([h1, h2]);
    expect(map.size).toBe(2);
    expect(map.get("p1/c1")).toBe(h1);
    expect(map.get("p1/c2")).toBe(h2);
  });
});

// --- computeSuggestions ---

describe("computeSuggestions", () => {
  it("returns empty for no deployments", () => {
    expect(computeSuggestions([])).toHaveLength(0);
  });

  it("returns empty for container with no usage", () => {
    const dep = deployment("app", [container("c", { cpuReq: 500, cpuLim: 1000 })]);
    expect(computeSuggestions([dep])).toHaveLength(0);
  });

  it("flags danger when usage near CPU limit", () => {
    const dep = deployment("app", [container("c", { cpuReq: 500, cpuLim: 1000, cpuUse: 950, memUse: 1 })]);
    const suggestions = computeSuggestions([dep]);
    const cpuDanger = suggestions.find((s) => s.resource === "CPU" && s.kind === "danger");
    expect(cpuDanger).toBeDefined();
    expect(cpuDanger?.action).toBe("Increase limit");
  });

  it("flags warning when usage moderately near limit", () => {
    const dep = deployment("app", [container("c", { cpuReq: 500, cpuLim: 1000, cpuUse: 750, memUse: 1 })]);
    const suggestions = computeSuggestions([dep]);
    const cpuWarn = suggestions.find((s) => s.resource === "CPU" && s.kind === "warning");
    expect(cpuWarn).toBeDefined();
  });

  it("flags overkill when request >> usage", () => {
    const dep = deployment("app", [container("c", { cpuReq: 1000, cpuLim: 2000, cpuUse: 50, memUse: 1 })]);
    const suggestions = computeSuggestions([dep]);
    const overkill = suggestions.find((s) => s.resource === "CPU" && s.kind === "overkill");
    expect(overkill).toBeDefined();
    expect(overkill?.action).toBe("Reduce request");
  });

  it("flags overkill when limit >> usage (limit over-provisioned)", () => {
    const dep = deployment("app", [container("c", { cpuReq: 200, cpuLim: 3000, cpuUse: 100, memUse: 1 })]);
    const suggestions = computeSuggestions([dep]);
    const overkill = suggestions.find((s) => s.resource === "CPU" && s.kind === "overkill" && s.action === "Reduce limit");
    expect(overkill).toBeDefined();
  });

  it("flags no-request warning", () => {
    const dep = deployment("app", [container("c", { cpuReq: 0, cpuLim: 1000, cpuUse: 100, memUse: 1 })]);
    const suggestions = computeSuggestions([dep]);
    const warn = suggestions.find((s) => s.resource === "CPU — no request");
    expect(warn).toBeDefined();
    expect(warn?.kind).toBe("warning");
  });

  it("flags no-limit warning", () => {
    const dep = deployment("app", [container("c", { cpuReq: 200, cpuLim: 0, cpuUse: 100, memUse: 1 })]);
    const suggestions = computeSuggestions([dep]);
    const warn = suggestions.find((s) => s.resource === "CPU — no limit");
    expect(warn).toBeDefined();
    expect(warn?.kind).toBe("warning");
  });

  it("sorts results: danger before warning before overkill", () => {
    // danger: usage near limit; overkill: request >> usage on memory
    const dep = deployment("app", [container("c", {
      cpuReq: 500, cpuLim: 1000, cpuUse: 950,
      memReq: 1000, memLim: 2000, memUse: 50,
    })]);
    const suggestions = computeSuggestions([dep]);
    const kinds = suggestions.map((s) => s.kind);
    const dangerIdx = kinds.indexOf("danger");
    const overkillIdx = kinds.indexOf("overkill");
    expect(dangerIdx).toBeLessThan(overkillIdx);
  });

  it("uses Prometheus P95 when history provided", () => {
    // snapshot usage is low but P95 from history is high (19/20 values = 950 → P95 = 950)
    const cpuPoints = Array.from({ length: 20 }, (_, i) => ({ t: i, v: i === 0 ? 100 : 950 }));
    const hist: ContainerHistory[] = [{ pod: "pod-1", container: "c", cpu: cpuPoints, memory: [] }];
    const dep = deployment("app", [container("c", { cpuReq: 500, cpuLim: 1000, cpuUse: 100, memUse: 1 })]);
    const suggestions = computeSuggestions([dep], hist);
    const danger = suggestions.find((s) => s.resource === "CPU" && s.kind === "danger");
    expect(danger).toBeDefined();
  });

  it("caps suggested CPU limit at node allocatable capacity", () => {
    // usage at 95% of 3800m limit → would suggest 3800*1.4=5320m, but node only has 4000m
    const dep = deployment("app", [container("c", { cpuReq: 500, cpuLim: 3800, cpuUse: 3610, memUse: 1 })]);
    const nodes = [node(4000, 8 * 1024 * 1024 * 1024)];
    const suggestions = computeSuggestions([dep], undefined, nodes);
    const danger = suggestions.find((s) => s.resource === "CPU" && s.kind === "danger");
    expect(danger).toBeDefined();
    expect(danger!.suggestedRaw).toBeLessThanOrEqual(4000);
    expect(danger!.message).toContain("capped to node capacity");
  });

  it("emits 'Migrate to larger node' when capped suggestion does not exceed current limit", () => {
    // usage at 95% of 4000m limit, node max is also 4000m → can't increase
    const dep = deployment("app", [container("c", { cpuReq: 500, cpuLim: 4000, cpuUse: 3800, memUse: 1 })]);
    const nodes = [node(4000, 8 * 1024 * 1024 * 1024)];
    const suggestions = computeSuggestions([dep], undefined, nodes);
    const migrate = suggestions.find((s) => s.action === "Migrate to larger node");
    expect(migrate).toBeDefined();
    expect(migrate!.kind).toBe("danger");
  });

  it("does not cap overkill (reduce) suggestions", () => {
    // limit is 3000m, usage is 100m → "Reduce limit" to ~150m, well within any node
    const dep = deployment("app", [container("c", { cpuReq: 200, cpuLim: 3000, cpuUse: 100, memUse: 1 })]);
    const nodes = [node(4000, 8 * 1024 * 1024 * 1024)];
    const suggestions = computeSuggestions([dep], undefined, nodes);
    const overkill = suggestions.find((s) => s.resource === "CPU" && s.action === "Reduce limit");
    expect(overkill).toBeDefined();
    expect(overkill!.suggestedRaw).toBeLessThan(3000);
  });

  it("ignores NotReady nodes when computing capacity", () => {
    // only NotReady node — cap should be 0 (no constraint applied)
    const dep = deployment("app", [container("c", { cpuReq: 500, cpuLim: 3800, cpuUse: 3610, memUse: 1 })]);
    const nodes = [node(4000, 8 * 1024 * 1024 * 1024, "NotReady")];
    const suggestions = computeSuggestions([dep], undefined, nodes);
    const danger = suggestions.find((s) => s.resource === "CPU" && s.kind === "danger");
    expect(danger).toBeDefined();
    // No cap applied → suggested > 4000m
    expect(danger!.suggestedRaw).toBeGreaterThan(4000);
    expect(danger!.message).not.toContain("capped");
  });
});

// --- replica aggregation (dedup) ---

describe("computeSuggestions — replica aggregation", () => {
  it("emits one suggestion per workload, not one per replica", () => {
    const c = container("app", { cpuReq: 1000, cpuLim: 2000, cpuUse: 50, memUse: 1 });
    const dep = workload("app", replicas(20, c));
    const overkill = computeSuggestions([dep]).filter((s) => s.resource === "CPU" && s.action === "Reduce request");
    expect(overkill).toHaveLength(1);
    expect(overkill[0].podCount).toBe(20);
  });

  it("aggregates each container of a multi-container pod separately", () => {
    const pods = Array.from({ length: 3 }, (_, i) => pod(`pod-${i + 1}`, [
      container("app", { cpuReq: 1000, cpuLim: 2000, cpuUse: 50, memUse: 1 }),
      container("sidecar", { cpuReq: 500, cpuLim: 1000, cpuUse: 10, memUse: 1 }),
    ]));
    const reduce = computeSuggestions([workload("app", pods)]).filter((s) => s.action === "Reduce request" && s.resource === "CPU");
    expect(reduce.map((s) => s.container).sort()).toEqual(["app", "sidecar"]);
  });

  it("pools history across replicas for the P95", () => {
    // Each replica is individually calm, but one replica sits at the limit.
    const calm = Array.from({ length: 20 }, (_, i) => ({ t: i, v: 100 }));
    const hot = Array.from({ length: 20 }, (_, i) => ({ t: i, v: 950 }));
    const hist: ContainerHistory[] = [
      { pod: "pod-1", container: "app", cpu: calm, memory: [] },
      { pod: "pod-2", container: "app", cpu: hot, memory: [] },
    ];
    const c = container("app", { cpuReq: 500, cpuLim: 1000, cpuUse: 100, memUse: 1 });
    const dep = workload("app", replicas(2, c));
    const danger = computeSuggestions([dep], hist).find((s) => s.resource === "CPU" && s.kind === "danger");
    expect(danger).toBeDefined();
    expect(danger!.podCount).toBe(2);
  });

  it("warns when replicas diverge in usage", () => {
    const low = Array.from({ length: 20 }, (_, i) => ({ t: i, v: 20 }));
    const high = Array.from({ length: 20 }, (_, i) => ({ t: i, v: 200 }));
    const hist: ContainerHistory[] = [
      { pod: "pod-1", container: "app", cpu: low, memory: [] },
      { pod: "pod-2", container: "app", cpu: high, memory: [] },
    ];
    const c = container("app", { cpuReq: 2000, cpuLim: 4000, cpuUse: 100, memUse: 1 });
    const dep = workload("app", replicas(2, c));
    const s = computeSuggestions([dep], hist).find((x) => x.resource === "CPU" && x.action === "Reduce request");
    expect(s?.warnings?.some((w) => w.includes("Replica usage varies"))).toBe(true);
  });

  it("keeps one row per PVC — replicas have distinct volumes", () => {
    const pods = [1, 2].map((i) => ({
      ...pod(`pod-${i}`, [container("app", { cpuReq: 100, cpuUse: 50, memUse: 1 })]),
      volumes: [{
        name: "data", type: "pvc" as const, pvcName: `data-pod-${i}`,
        capacity: mem(1000 * MiB), usage: mem(950 * MiB),
      }],
    }));
    const pvc = computeSuggestions([workload("sts", pods, { kind: "StatefulSet" })]).filter((s) => s.resource === "PVC");
    expect(pvc).toHaveLength(2);
    expect(pvc.map((s) => s.container).sort()).toEqual(["data-pod-1", "data-pod-2"]);
  });

  it("deduplicates emptyDir across replicas — same template volume", () => {
    const pods = [1, 2, 3].map((i) => ({
      ...pod(`pod-${i}`, [container("app", { cpuReq: 100, cpuUse: 50, memUse: 1 })]),
      volumes: [{ name: "cache", type: "emptyDir" as const, usage: mem(100 * MiB) }],
    }));
    const emptyDirs = computeSuggestions([workload("app", pods)]).filter((s) => s.resource === "EmptyDir");
    expect(emptyDirs).toHaveLength(1);
  });
});

// --- OOMKilled / restart guards ---

describe("computeSuggestions — OOMKilled and restart guards", () => {
  it("raises a danger and blocks memory reduction when OOMKilled", () => {
    // Memory limit is 10× the observed usage — normally a "Reduce limit" overkill.
    const c = container("app", { memReq: 100 * MiB, memLim: 1000 * MiB, memUse: 50 * MiB, cpuUse: 1, oomKilled: true, restartCount: 2 });
    const suggestions = computeSuggestions([workload("app", replicas(1, c))]);
    const memSuggestions = suggestions.filter((s) => s.resource === "Memory");
    expect(memSuggestions.some((s) => s.action.startsWith("Reduce"))).toBe(false);
    const danger = memSuggestions.find((s) => s.kind === "danger");
    expect(danger).toBeDefined();
    expect(danger!.message).toContain("OOMKilled");
    expect(danger!.suggestedRaw).toBeGreaterThan(1000 * MiB);
  });

  it("does not block CPU reduction when only memory was OOMKilled", () => {
    const c = container("app", { cpuReq: 1000, cpuLim: 2000, cpuUse: 50, memReq: 100 * MiB, memLim: 200 * MiB, memUse: 150 * MiB, oomKilled: true });
    const suggestions = computeSuggestions([workload("app", replicas(1, c))]);
    expect(suggestions.some((s) => s.resource === "CPU" && s.action === "Reduce request")).toBe(true);
  });

  it("falls back to 'Migrate to larger node' when the node cannot hold a bigger limit", () => {
    const c = container("app", { memReq: 100 * MiB, memLim: 4000 * MiB, memUse: 3900 * MiB, cpuUse: 1, oomKilled: true });
    const nodes = [node(4000, 4000 * MiB)];
    const s = computeSuggestions([workload("app", replicas(1, c))], undefined, nodes)
      .find((x) => x.resource === "Memory" && x.action === "Migrate to larger node");
    expect(s).toBeDefined();
    expect(s!.suggestedRaw).toBe(4000 * MiB);
    expect(toKubectlCmd(s!)).toBeNull();
  });

  it("flags OOMKilled with no limit as a node-level OOM danger", () => {
    const c = container("app", { memReq: 100 * MiB, memLim: 0, memUse: 500 * MiB, cpuUse: 1, oomKilled: true });
    const s = computeSuggestions([workload("app", replicas(1, c))]).find((x) => x.resource === "Memory — no limit");
    expect(s?.kind).toBe("danger");
    expect(s?.message).toContain("node ran out of memory");
  });

  it("treats OOM on any single replica as OOM for the workload", () => {
    const healthy = pod("pod-1", [container("app", { memReq: 100 * MiB, memLim: 1000 * MiB, memUse: 50 * MiB, cpuUse: 1 })]);
    const killed = pod("pod-2", [container("app", { memReq: 100 * MiB, memLim: 1000 * MiB, memUse: 50 * MiB, cpuUse: 1, oomKilled: true })]);
    const mems = computeSuggestions([workload("app", [healthy, killed])]).filter((s) => s.resource === "Memory");
    expect(mems.some((s) => s.action.startsWith("Reduce"))).toBe(false);
    expect(mems.some((s) => s.kind === "danger")).toBe(true);
  });

  it("suppresses all reductions for a crashlooping container", () => {
    const c = container("app", { cpuReq: 1000, cpuLim: 2000, cpuUse: 50, memUse: 1, restartCount: 7 });
    const suggestions = computeSuggestions([workload("app", replicas(1, c))]);
    expect(suggestions.some((s) => s.action.startsWith("Reduce"))).toBe(false);
  });

  it("surfaces restart count as a warning", () => {
    const c = container("app", { cpuReq: 500, cpuLim: 1000, cpuUse: 950, memUse: 1, restartCount: 2 });
    const s = computeSuggestions([workload("app", replicas(1, c))]).find((x) => x.resource === "CPU" && x.kind === "danger");
    expect(s?.warnings?.some((w) => w.includes("2 restarts"))).toBe(true);
  });
});

// --- burst detection ---

describe("computeSuggestions — burst detection", () => {
  /** A container idling at `idle` with a short spike to `peak`. */
  function spikySeries(idle: number, peak: number, n = 200): ContainerHistory[] {
    const points = Array.from({ length: n }, (_, i) => ({ t: i, v: i < 2 ? peak : idle }));
    return [{ pod: "pod-1", container: "app", cpu: points, memory: [] }];
  }

  it("does not recommend a reduction below the observed peak", () => {
    // Idles at 100m, starts up at 3000m. Naive mean-based advice would suggest ~170m,
    // which starves the startup burst and fails the liveness probe on the next rollout.
    const hist = spikySeries(100, 3000);
    const c = container("app", { cpuReq: 8000, cpuLim: 16000, cpuUse: 100, memUse: 1 });
    const s = computeSuggestions([workload("app", replicas(1, c))], hist).find((x) => x.resource === "CPU" && x.action === "Reduce request");
    expect(s).toBeDefined();
    expect(s!.suggestedRaw).toBeGreaterThanOrEqual(3000);
    expect(s!.message).toContain("bursty");
  });

  it("drops the reduction when the peak leaves nothing to save", () => {
    // Peak 3000m against a 3000m limit — reducing to peak-based value saves <10%.
    const hist = spikySeries(100, 3000);
    const c = container("app", { cpuReq: 200, cpuLim: 3000, cpuUse: 100, memUse: 1 });
    const s = computeSuggestions([workload("app", replicas(1, c))], hist).find((x) => x.resource === "CPU" && x.action === "Reduce limit");
    expect(s).toBeUndefined();
  });

  it("leaves steady workloads on mean-based sizing", () => {
    const steady: ContainerHistory[] = [{
      pod: "pod-1", container: "app",
      cpu: Array.from({ length: 200 }, (_, i) => ({ t: i, v: 100 })),
      memory: [],
    }];
    const c = container("app", { cpuReq: 1000, cpuLim: 2000, cpuUse: 100, memUse: 1 });
    const s = computeSuggestions([workload("app", replicas(1, c))], steady).find((x) => x.resource === "CPU" && x.action === "Reduce request");
    expect(s).toBeDefined();
    expect(s!.message).not.toContain("bursty");
    expect(s!.suggestedRaw).toBeLessThan(300);
  });
});

// --- QoS class ---

describe("computeSuggestions — QoS awareness", () => {
  it("moves request and limit together for Guaranteed pods", () => {
    const c = container("app", { cpuReq: 1000, cpuLim: 1000, cpuUse: 50, memUse: 1 });
    const dep = workload("app", replicas(1, c), { qosClass: "Guaranteed" });
    const s = computeSuggestions([dep]).find((x) => x.resource === "CPU" && x.kind === "overkill");
    expect(s?.action).toBe("Reduce request + limit");
    expect(s?.appliesToBoth).toBe(true);
    expect(s?.warnings?.some((w) => w.includes("Guaranteed"))).toBe(true);
  });

  it("emits a single reduction for a Guaranteed pair, not two contradicting ones", () => {
    const c = container("app", { cpuReq: 1000, cpuLim: 1000, cpuUse: 50, memUse: 1 });
    const dep = workload("app", replicas(1, c), { qosClass: "Guaranteed" });
    const reductions = computeSuggestions([dep]).filter((x) => x.resource === "CPU" && x.action.startsWith("Reduce"));
    expect(reductions).toHaveLength(1);
  });

  it("keeps separate request/limit suggestions for Burstable pods", () => {
    const c = container("app", { cpuReq: 1000, cpuLim: 2000, cpuUse: 50, memUse: 1 });
    const dep = workload("app", replicas(1, c), { qosClass: "Burstable" });
    const s = computeSuggestions([dep]).find((x) => x.resource === "CPU" && x.action === "Reduce request");
    expect(s?.appliesToBoth).toBeUndefined();
  });
});

// --- toKubectlCmd (DOM-1) ---

describe("toKubectlCmd", () => {
  function firstSuggestion(dep: DeploymentDetail, action: string) {
    const s = computeSuggestions([dep]).find((x) => x.action === action && x.resource === "CPU");
    if (!s) throw new Error(`no "${action}" suggestion produced`);
    return s;
  }

  it("targets deployment/ for Deployments", () => {
    const c = container("app", { cpuReq: 1000, cpuLim: 2000, cpuUse: 50, memUse: 1 });
    const cmd = toKubectlCmd(firstSuggestion(workload("api", replicas(1, c)), "Reduce request"));
    expect(cmd).toContain("deployment/api");
  });

  it("targets statefulset/ for StatefulSets", () => {
    const c = container("app", { cpuReq: 1000, cpuLim: 2000, cpuUse: 50, memUse: 1 });
    const dep = workload("db", replicas(1, c), { kind: "StatefulSet" });
    const cmd = toKubectlCmd(firstSuggestion(dep, "Reduce request"));
    expect(cmd).toContain("statefulset/db");
    expect(cmd).not.toContain("deployment/");
  });

  it("returns null for CronJobs — set resources cannot reach the nested pod template", () => {
    const c = container("app", { cpuReq: 1000, cpuLim: 2000, cpuUse: 50, memUse: 1 });
    const dep = workload("backup", replicas(1, c), { kind: "CronJob" });
    expect(toKubectlCmd(firstSuggestion(dep, "Reduce request"))).toBeNull();
  });

  it("sets both flags for a Guaranteed pair", () => {
    const c = container("app", { cpuReq: 1000, cpuLim: 1000, cpuUse: 50, memUse: 1 });
    const dep = workload("api", replicas(1, c), { qosClass: "Guaranteed" });
    const cmd = toKubectlCmd(firstSuggestion(dep, "Reduce request + limit"))!;
    expect(cmd).toContain("--requests=cpu=");
    expect(cmd).toContain("--limits=cpu=");
  });

  it("returns null for node-capacity-blocked suggestions", () => {
    const c = container("app", { cpuReq: 500, cpuLim: 4000, cpuUse: 3800, memUse: 1 });
    const dep = workload("api", replicas(1, c));
    const s = computeSuggestions([dep], undefined, [node(4000, 8 * 1024 * MiB)]).find((x) => x.action === "Migrate to larger node");
    expect(toKubectlCmd(s!)).toBeNull();
  });
});

// --- maxNodeCapacity ---

describe("maxNodeCapacity", () => {
  it("returns zeros for empty node list", () => {
    const cap = maxNodeCapacity([]);
    expect(cap.maxCpuMillicores).toBe(0);
    expect(cap.maxMemoryBytes).toBe(0);
  });

  it("picks max across Ready nodes", () => {
    const nodes = [node(2000, 4 * 1024 * 1024 * 1024), node(8000, 16 * 1024 * 1024 * 1024)];
    const cap = maxNodeCapacity(nodes);
    expect(cap.maxCpuMillicores).toBe(8000);
    expect(cap.maxMemoryBytes).toBe(16 * 1024 * 1024 * 1024);
  });

  it("excludes NotReady nodes", () => {
    const nodes = [node(8000, 16 * 1024 * 1024 * 1024, "NotReady"), node(2000, 4 * 1024 * 1024 * 1024)];
    const cap = maxNodeCapacity(nodes);
    expect(cap.maxCpuMillicores).toBe(2000);
  });
});
