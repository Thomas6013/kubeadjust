export const STORAGE_KEYS = {
  view:        "kubeadjust:view",
  autoRefresh: "kubeadjust:autoRefresh",
  selectedNs:  "kubeadjust:selectedNs",
  timeRange:   "kubeadjust:timeRange",
  openCards:   "kubeadjust:openCards",
  excludedNs:  "kubeadjust:excludedNs",
  cluster:     "kube-cluster",
} as const;

/** Returns the sessionStorage key for a cluster's token. */
export function tokenKey(cluster: string): string {
  return cluster ? `kube-token:${cluster}` : "kube-token";
}

export function safeGetItem(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

export function safeSetItem(key: string, value: string): void {
  try { sessionStorage.setItem(key, value); } catch { /* QuotaExceededError or private mode */ }
}

export function safeRemoveItem(key: string): void {
  try { sessionStorage.removeItem(key); } catch { /* ignore */ }
}
