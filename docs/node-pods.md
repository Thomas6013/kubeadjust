# Node Pod Drill-down

Click the **Pods (n)** button at the bottom of any node card to expand a list of all active pods running on that node.

## What is shown

For each pod:
- Pod name and namespace
- Phase (Running / Pending)
- Per-container breakdown:
  - CPU and memory **requests**
  - CPU and memory **limits**
  - Live **usage** from metrics-server (if available)

Containers are rendered using the same card view as the namespace workload view, with the same colour-coded resource bars.

## Behaviour

- **Lazy load** — pods are fetched the first time you expand a node. Subsequent toggles reuse the cached result. To force a refresh, use the global refresh button in the topbar.
- **Cross-namespace** — pods from all namespaces on the node are listed. The namespace is shown next to each pod name.
- **No Prometheus** — sparklines and history are not shown in this view (no namespace context is available for Prometheus queries).
- **Terminal pods excluded** — `Succeeded` and `Failed` pods are not included.

## API

```
GET /api/nodes/{node}/pods
Authorization: Bearer <token>
X-Cluster: <name>   (optional, multi-cluster)
```

Returns a sorted array of `PodDetail` objects, each with a `namespace` field.

## Performance

Each click triggers a cluster-wide pod list fetch (`/api/v1/pods`) and a cluster-wide metrics fetch (`/apis/metrics.k8s.io/v1beta1/pods`). On large clusters, avoid expanding many nodes simultaneously at high auto-refresh frequencies.
