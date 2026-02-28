# KubeAdjust

> See what your Kubernetes workloads actually use vs what they request — and get suggestions to right-size them.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Go](https://img.shields.io/badge/go-1.22+-00ADD8.svg)](https://golang.org/)
[![Next.js](https://img.shields.io/badge/next.js-16-black.svg)](https://nextjs.org/)

---

![KubeAdjust dashboard](docs/screenshot.png)

> **Alpha software** — This is a personal project, maintained by a single developer with the help of an AI coding agent. Expect rough edges. Contributions welcome, response times may vary.

> **Read-only** — KubeAdjust never modifies your cluster. It only reads resource data. If you apply the suggestions manually, be aware that changing requests/limits on a running Pod triggers a **restart**.

---

## Why?

Most clusters waste resources because requests and limits are set once and never revisited.

**Before KubeAdjust:** your Pod requests 2Gi memory, but only uses 180Mi. You don't know — it just runs.

**After KubeAdjust:** you see the over-provisioning instantly, with a concrete suggestion: _"Reduce memory request to 256Mi (current P95: 195Mi)"_.

KubeAdjust shows for every Deployment, StatefulSet and CronJob:
- CPU and memory **requests / limits / actual usage** side-by-side
- Color-coded status (critical / warning / over-provisioned / healthy)
- Actionable **right-sizing suggestions** with confidence levels
- Optional **sparklines** from Prometheus (1h to 7d trends)
- Cluster-wide **node overview** (capacity vs actual usage)

---

## Install

### Helm (production)

```bash
helm install kubeadjust ./helm/kubeadjust \
  --namespace kubeadjust --create-namespace \
  --set backend.image.repository=ghcr.io/thomas6013/kubeadjust/kubeadjust-backend \
  --set frontend.image.repository=ghcr.io/thomas6013/kubeadjust/kubeadjust-frontend \
  --set ingress.enabled=true \
  --set ingress.host=kubeadjust.your-domain.com
```

Get a login token:

```bash
kubectl create token kubeadjust -n kubeadjust
```

### Docker Compose (local)

```bash
git clone https://github.com/thomas6013/kubeadjust.git && cd kubeadjust

export KUBE_API_SERVER=https://<your-cluster-api>
export KUBE_INSECURE_TLS=true   # if self-signed cert

docker compose up --build
```

Open http://localhost:3000, paste your token, done.

### Local dev

```bash
# Backend (Go 1.22+)
cd backend && KUBE_API_SERVER=https://<your-cluster> go run .

# Frontend (Node 20+)
cd frontend && npm install && npm run dev
```

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `KUBE_API_SERVER` | `https://kubernetes.default.svc` | Kubernetes API URL |
| `KUBE_INSECURE_TLS` | `false` | Skip TLS verification |
| `PROMETHEUS_URL` | _(empty)_ | Prometheus URL for sparklines (optional) |
| `ALLOWED_ORIGINS` | `*` | CORS origins (comma-separated) |
| `PORT` | `8080` | Backend listen port |

**Prometheus:** set `PROMETHEUS_URL` to enable sparklines and P95-based suggestions. Works with or without `http://` prefix.

**metrics-server:** required for live usage data. If not installed, enable the sub-chart: `--set metrics-server.enabled=true`.

---

## Architecture

```
Browser → Next.js (port 3000) → /api/* proxy → Go backend (port 8080)
                                                  ├── Kubernetes API
                                                  ├── metrics-server
                                                  └── Prometheus (optional)
```

Stateless — no database, no cache. Your K8s token is forwarded on every request, never stored server-side.

---

## Security

- **Read-only RBAC** — the Helm ClusterRole only has `get`, `list`, `watch` permissions
- **Token in sessionStorage** — cleared on tab close, never logged or persisted
- **PromQL injection prevention** — strict whitelist validation on all label values
- **10MB response cap** — `io.LimitReader` on all upstream responses
- **CSP + security headers** — configured in Next.js

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache 2.0 — see [LICENSE](LICENSE).
