import { describe, it, expect } from "vitest";
import {
  resourceStatus,
  storageStatus,
  buildHistoryMap,
  computeSuggestions,
  maxNodeCapacity,
} from "./suggestions";
import type { ResourceValue, ContainerResources, DeploymentDetail, ContainerHistory, NodeOverview, NodeResources } from "./api";

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
  } = {},
): ContainerResources {
  const { cpuReq = 0, memReq = 0, cpuLim = 0, memLim = 0, cpuUse, memUse } = opts;
  return {
    name,
    requests: { cpu: cpu(cpuReq), memory: mem(memReq) },
    limits:   { cpu: cpu(cpuLim), memory: mem(memLim) },
    usage: cpuUse !== undefined || memUse !== undefined
      ? { cpu: cpu(cpuUse ?? 0), memory: mem(memUse ?? 0) }
      : undefined,
  };
}

function deployment(name: string, containers: ContainerResources[]): DeploymentDetail {
  return {
    kind: "Deployment", name, namespace: "default",
    replicas: 1, readyReplicas: 1, availableReplicas: 1,
    pods: [{ name: "pod-1", phase: "Running", containers }],
  };
}

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
