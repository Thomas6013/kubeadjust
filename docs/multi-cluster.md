# Multi-cluster Configuration

KubeAdjust supports connecting to multiple Kubernetes clusters. The cluster selector appears on the login page when more than one cluster is configured.

## How it works

1. The backend is started with a `CLUSTERS` env var listing all clusters.
2. The login page fetches `GET /api/clusters` (no auth required) to get the list.
3. If more than one cluster is configured, a dropdown appears before the token field.
4. After selecting a cluster and signing in, all API requests include an `X-Cluster: <name>` header.
5. The backend middleware routes the request to the correct Kubernetes API server.
6. The selected cluster is persisted in `sessionStorage` and shown as a badge in the topbar.

## Backend configuration

Set the `CLUSTERS` environment variable using the format `name=url` — comma-separated:

```bash
CLUSTERS="prod=https://k8s.prod.example.com:6443,staging=https://k8s.staging.example.com:6443"
```

- **`name`** — display name shown in the login page selector (alphanumeric, hyphens, dots).
- **`url`** — the Kubernetes API server URL reachable from the backend pod.

If `CLUSTERS` is not set, the backend falls back to single-cluster mode using `KUBE_API_SERVER`.

## Helm

Set `backend.clusters` in your `values.yaml`:

```yaml
backend:
  clusters: "prod=https://k8s.prod.example.com:6443,staging=https://k8s.staging.example.com:6443"
```

Or override at install time:

```bash
helm upgrade --install kubeadjust ./helm/kubeadjust \
  --set backend.clusters="prod=https://k8s.prod:6443,staging=https://k8s.staging:6443"
```

## Generating tokens for each cluster

Apply the viewer ServiceAccount on each cluster you want to connect to:

```bash
# On each remote cluster:
kubectl apply -f deploy/viewer-serviceaccount.yaml

# Generate a short-lived token (8 hours):
kubectl create token kubeadjust-viewer -n kubeadjust --duration=8h
```

The token grants read-only access (namespaces, pods, deployments, statefulsets, jobs, metrics).

## Security notes

- Cluster names are validated against the configured whitelist — arbitrary URLs cannot be injected via the `X-Cluster` header.
- Cluster URLs are never sent to the frontend; only names are exposed via `GET /api/clusters`.
- CORS is configured to allow the `X-Cluster` header — no additional CORS changes needed.
