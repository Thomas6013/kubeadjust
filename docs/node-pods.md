# Node Pod View

Click the **Pods (N) ▶** button at the bottom of any node card to expand a paginated list of active pods running on that node.

## What is shown

For each pod:
- Pod name and namespace
- A compact horizontal bar for **CPU** and **Memory** showing:
  - Request as a percentage of node allocatable (semi-transparent fill)
  - Live usage as a percentage of node allocatable (solid fill), when metrics-server is available
  - Exact values and percentages on hover (tooltip on each bar)

Hovering a bar shows details such as `req: 250m (12%) · use: 180m (9%)` or `req: 250m (12%) · no usage data`.

## Behaviour

- **Lazy load** — pods are fetched the first time you expand a node. Subsequent toggles reuse the cached result. To force a refresh, use the global refresh button in the topbar.
- **Pagination** — up to 10 pods are shown per page. Use the Prev / Next buttons to navigate. The current page and total are shown (e.g. `1–10 / 34`).
- **Cross-namespace** — pods from all namespaces on the node are listed. The namespace is shown next to each pod name.
- **No Prometheus** — sparklines and history are not shown in this view (no namespace context for Prometheus queries).
- **Terminal pods excluded** — `Succeeded` and `Failed` pods are not included.

## API

```
GET /api/nodes/{node}/pods
Authorization: Bearer <token>
X-Cluster: <name>   (optional, multi-cluster)
```

Returns a sorted array of `PodDetail` objects, each with a `namespace` field and per-container requests, limits, and optional usage.

## Performance

Each click triggers a cluster-wide pod list fetch (`/api/v1/pods`) and a cluster-wide metrics fetch (`/apis/metrics.k8s.io/v1beta1/pods`). On large clusters, avoid expanding many nodes simultaneously at high auto-refresh frequencies.
