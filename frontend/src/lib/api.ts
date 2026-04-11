import { MANAGED_TOKEN, safeGetItem, STORAGE_KEYS } from "@/lib/storage";

export interface ResourceValue {
  raw: string;
  millicores?: number;
  bytes?: number;
}

export interface ResourcePair {
  cpu: ResourceValue;
  memory: ResourceValue;
}

export interface EphemeralStorageInfo {
  request?: ResourceValue; // undefined = not set in spec
  limit?: ResourceValue;   // undefined = no limit
  usage?: ResourceValue;   // undefined = kubelet unavailable
}

export interface VolumeDetail {
  name: string;
  type: "pvc" | "emptyDir" | "other";
  medium?: string;        // emptyDir: "" | "Memory"
  sizeLimit?: ResourceValue;  // emptyDir explicit limit
  pvcName?: string;
  storageClass?: string;
  accessModes?: string[];
  capacity?: ResourceValue;
  usage?: ResourceValue;
  available?: ResourceValue;
}

export interface ContainerResources {
  name: string;
  requests: ResourcePair;
  limits: ResourcePair;
  usage?: ResourcePair;
  ephemeralStorage?: EphemeralStorageInfo;
}

export interface PodDetail {
  name: string;
  namespace?: string;
  phase: string;
  containers: ContainerResources[];
  volumes?: VolumeDetail[];
}

export interface DeploymentDetail {
  kind: string; // "Deployment" | "StatefulSet" | "CronJob"
  name: string;
  namespace: string;
  replicas: number;
  readyReplicas: number;
  availableReplicas: number;
  pods: PodDetail[];
}

export interface NodeResources {
  cpu: ResourceValue;
  memory: ResourceValue;
}

export interface NodeTaint {
  key: string;
  value?: string;
  effect: "NoSchedule" | "PreferNoSchedule" | "NoExecute";
}

export interface NodeOverview {
  name: string;
  status: "Ready" | "NotReady" | "Unknown";
  roles: string[];
  taints?: NodeTaint[];
  capacity: NodeResources;
  allocatable: NodeResources;
  requested: NodeResources;
  limited: NodeResources;
  usage?: NodeResources;
  podCount: number;
  maxPods: number;
  kernelVersion?: string;
  osImage?: string;
  age?: string;
  diskPressure: boolean;
  memoryPressure: boolean;
  pidPressure: boolean;
}

export interface NamespaceItem {
  name: string;
}

export interface NamespaceStats {
  name: string;
  cpuRequestedM: number;
  cpuLimitedM: number;
  memRequestedB: number;
  memLimitedB: number;
  cpuUsageM: number; // 0 if metrics-server unavailable
  memUsageB: number; // 0 if metrics-server unavailable
  cpuRatio: number; // lim/req; 0 = no requests set
  memRatio: number;
}

/** Typed error thrown by apiFetch when the backend returns a non-2xx status. */
class APIError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Generic authenticated fetch helper. Throws APIError on non-2xx responses. */
async function apiFetch<T>(path: string, token: string): Promise<T> {
  const reqHeaders: Record<string, string> = {};
  // Managed clusters use a backend SA token — no Authorization header sent.
  if (token && token !== MANAGED_TOKEN) {
    reqHeaders["Authorization"] = `Bearer ${token}`;
  }
  const cluster = safeGetItem(STORAGE_KEYS.cluster);
  if (cluster) reqHeaders["X-Cluster"] = cluster;
  const res = await fetch(`/api${path}`, { headers: reqHeaders });
  if (!res.ok) {
    if (res.status === 401) {
      try {
        for (const k of Object.keys(sessionStorage).filter((k) => k === "kube-token" || k.startsWith("kube-token:"))) {
          sessionStorage.removeItem(k);
        }
      } catch { /* ignore */ }
      window.location.href = "/";
      throw new APIError(401, "Session expired");
    }
    let msg = res.statusText;
    try { msg = (await res.json()).error ?? msg; } catch { /* non-JSON error body */ }
    throw new APIError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export interface ClusterItem {
  name: string;
  managed: boolean; // true = backend holds SA token, no user token required
}

/** Fetches configured cluster names — no auth required. Returns [] on error. */
async function fetchClusters(): Promise<ClusterItem[]> {
  try {
    const res = await fetch("/api/clusters", { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    return res.json() as Promise<ClusterItem[]>;
  } catch {
    return [];
  }
}

export interface AuthConfig {
  oidcEnabled: boolean;
  managedDefault: boolean; // true = single-cluster, backend SA token, no user token required
}

/** Returns OIDC configuration — no auth required. */
async function fetchAuthConfig(): Promise<AuthConfig> {
  try {
    const res = await fetch("/api/auth/config", { headers: { Accept: "application/json" } });
    if (!res.ok) return { oidcEnabled: false, managedDefault: false };
    return res.json() as Promise<AuthConfig>;
  } catch {
    return { oidcEnabled: false, managedDefault: false };
  }
}

export interface DataPoint {
  t: number; // unix seconds
  v: number; // millicores (cpu) or bytes (memory)
}

export interface HistoryResponse {
  cpu: DataPoint[];
  memory: DataPoint[];
}

export type TimeRange = "1h" | "6h" | "24h" | "7d";

export interface ContainerHistory {
  pod: string;
  container: string;
  cpu: DataPoint[];
  memory: DataPoint[];
}

export interface NamespaceHistoryResponse {
  containers: ContainerHistory[];
}

export interface WorkloadResponse {
  workloads: DeploymentDetail[];
  metricsAvailable: boolean;
  prometheusAvailable: boolean;
}

export interface NodesResponse {
  nodes: NodeOverview[];
  prometheusAvailable: boolean;
}

export const api = {
  clusters: () => fetchClusters(),
  authConfig: () => fetchAuthConfig(),
  verify: (token: string) =>
    apiFetch<{ status: string }>("/auth/verify", token),
  namespaces: (token: string) =>
    apiFetch<NamespaceItem[]>("/namespaces", token),
  namespaceStats: (token: string) =>
    apiFetch<NamespaceStats[]>("/namespaces/stats", token),
  deployments: (token: string, namespace: string) =>
    apiFetch<WorkloadResponse>(`/namespaces/${namespace}/deployments`, token),
  nodes: (token: string) =>
    apiFetch<NodesResponse>("/nodes", token),
  nodePods: (token: string, nodeName: string) =>
    apiFetch<PodDetail[]>(`/nodes/${encodeURIComponent(nodeName)}/pods`, token),
  containerHistory: (token: string, namespace: string, pod: string, container: string, range?: TimeRange) =>
    apiFetch<HistoryResponse>(`/namespaces/${namespace}/prometheus/${encodeURIComponent(pod)}/${encodeURIComponent(container)}${range ? `?range=${range}` : ""}`, token),
  namespaceHistory: (token: string, namespace: string, range?: TimeRange) =>
    apiFetch<NamespaceHistoryResponse>(`/namespaces/${namespace}/prometheus${range ? `?range=${range}` : ""}`, token),
};

// --- Formatting helpers ---

/**
 * Formats a raw resource value (millicores for CPU, bytes for memory) as a human-readable string.
 * Used as the shared base by fmtCPU, fmtMemory, and the suggestion/sparkline formatters.
 *   CPU  : ≥1000m → "1.50 cores",  otherwise → "500m"
 *   Memory: ≥1 GiB → "1.50 GiB",  ≥1 MiB → "512 MiB",  otherwise → "256 KiB"
 */
export function fmtRawValue(v: number, isCPU: boolean): string {
  if (isCPU) {
    if (v >= 1000) return `${(v / 1000).toFixed(2)} cores`;
    return `${Math.round(v)}m`;
  }
  const gib = v / 1024 ** 3;
  if (gib >= 1) return `${gib.toFixed(2)} GiB`;
  const mib = v / 1024 ** 2;
  if (mib >= 1) return `${mib.toFixed(0)} MiB`;
  return `${(v / 1024).toFixed(0)} KiB`;
}

/** Formats a CPU ResourceValue as millicores ("500m") or cores ("1.50 cores"). */
export function fmtCPU(rv: ResourceValue): string {
  if (!rv?.raw) return "—";
  if (rv.millicores !== undefined && rv.millicores > 0) return fmtRawValue(rv.millicores, true);
  return rv.raw;
}

/** Formats a memory ResourceValue as KiB/MiB/GiB. */
export function fmtMemory(rv: ResourceValue): string {
  if (!rv?.raw) return "—";
  if (rv.bytes !== undefined && rv.bytes > 0) return fmtRawValue(rv.bytes, false);
  return rv.raw;
}

/** Formats a storage ResourceValue (delegates to fmtMemory). */
export function fmtStorage(rv: ResourceValue | undefined): string {
  if (!rv) return "—";
  return fmtMemory(rv);
}

/** Returns usage as a percentage of limit (0–100), or null if either value is missing/zero. */
export function usagePct(
  usage: ResourceValue | undefined,
  limit: ResourceValue | undefined,
  isCPU: boolean,
): number | null {
  if (!usage || !limit) return null;
  const u = isCPU ? (usage.millicores ?? 0) : (usage.bytes ?? 0);
  const l = isCPU ? (limit.millicores ?? 0) : (limit.bytes ?? 0);
  if (l === 0) return null;
  return Math.min(100, Math.round((u / l) * 100));
}

/** Returns storage usage as a percentage of capacity (0–100), or null if missing/zero. */
export function storagePct(
  usage: ResourceValue | undefined,
  capacity: ResourceValue | undefined,
): number | null {
  if (!usage || !capacity) return null;
  const u = usage.bytes ?? 0;
  const c = capacity.bytes ?? 0;
  if (c === 0) return null;
  return Math.min(100, Math.round((u / c) * 100));
}
