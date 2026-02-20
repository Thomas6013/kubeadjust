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
  phase: string;
  containers: ContainerResources[];
  volumes?: VolumeDetail[];
}

export interface DeploymentDetail {
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

export interface NodeOverview {
  name: string;
  status: "Ready" | "NotReady" | "Unknown";
  roles: string[];
  capacity: NodeResources;
  allocatable: NodeResources;
  requested: NodeResources;
  limited: NodeResources;
  usage?: NodeResources;
  podCount: number;
  maxPods: number;
}

export interface NamespaceItem {
  name: string;
}

class APIError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function apiFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error ?? msg; } catch { /* non-JSON error body */ }
    throw new APIError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  verify: (token: string) =>
    apiFetch<{ status: string }>("/auth/verify", token),
  namespaces: (token: string) =>
    apiFetch<NamespaceItem[]>("/namespaces", token),
  deployments: (token: string, namespace: string) =>
    apiFetch<DeploymentDetail[]>(`/namespaces/${namespace}/deployments`, token),

  nodes: (token: string) =>
    apiFetch<NodeOverview[]>("/nodes", token),
};

// --- Formatting helpers ---

export function fmtCPU(rv: ResourceValue): string {
  if (!rv?.raw) return "—";
  if (rv.millicores !== undefined && rv.millicores > 0) {
    if (rv.millicores >= 1000) return `${(rv.millicores / 1000).toFixed(2)} cores`;
    return `${rv.millicores}m`;
  }
  return rv.raw;
}

export function fmtMemory(rv: ResourceValue): string {
  if (!rv?.raw) return "—";
  if (rv.bytes !== undefined && rv.bytes > 0) {
    const gib = rv.bytes / 1024 ** 3;
    if (gib >= 1) return `${gib.toFixed(2)} GiB`;
    const mib = rv.bytes / 1024 ** 2;
    if (mib >= 1) return `${mib.toFixed(0)} MiB`;
    return `${(rv.bytes / 1024).toFixed(0)} KiB`;
  }
  return rv.raw;
}

export function fmtStorage(rv: ResourceValue | undefined): string {
  if (!rv) return "—";
  return fmtMemory(rv);
}

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
