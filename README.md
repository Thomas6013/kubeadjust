# KubeAdjust

Lightweight Kubernetes resource dashboard — visualise requests, limits and live usage (via metrics-server) for every deployment and pod, without any persistence.

## Architecture

```
┌─────────────────┐       bearer token       ┌─────────────────────┐
│  Next.js front  │ ──────/api/* rewrite──▶  │    Go backend        │
│  (port 3000)    │                           │    (port 8080)       │
└─────────────────┘                           │  proxies k8s API     │
                                              │  + metrics-server    │
                                              └─────────────────────┘
```

- **No persistence** — all data is fetched on-the-fly from the Kubernetes API
- **Token-based auth** — the user pastes a service account token (like kube-dashboard)
- **Metrics-server** — live CPU/memory consumption per container (graceful fallback if unavailable)

## Quick start (local dev)

### Backend

```bash
cd backend
go mod tidy
KUBE_API_SERVER=https://<your-cluster> KUBE_INSECURE_TLS=true go run .
```

### Frontend

```bash
cd frontend
npm install
BACKEND_URL=http://localhost:8080 npm run dev
```

Open http://localhost:3000, paste a token, done.

## Docker build

```bash
# Backend
docker build -t kubeadjust-backend:dev ./backend

# Frontend
docker build --build-arg BACKEND_URL=http://kubeadjust-backend:8080 \
  -t kubeadjust-frontend:dev ./frontend
```

## Helm install

```bash
helm install kubeadjust ./helm/kubeadjust \
  --namespace kubeadjust --create-namespace \
  --set backend.image.repository=<registry>/kubeadjust-backend \
  --set frontend.image.repository=<registry>/kubeadjust-frontend \
  --set ingress.enabled=true \
  --set ingress.host=kubeadjust.your-domain.com
```

After install, get a login token:

```bash
kubectl create token kubeadjust -n kubeadjust
```

## RBAC

The Helm chart creates a `ClusterRole` (`kubeadjust-viewer`) with read access to:
- `namespaces`, `pods` (core)
- `deployments`, `replicasets` (apps)
- `pods`, `nodes` metrics (metrics.k8s.io)

Bind it to any user/group:

```bash
kubectl create clusterrolebinding my-user-kubeadjust \
  --clusterrole=kubeadjust-viewer \
  --user=my@user.com
```

## Roadmap (V2)

- Resource adjustment recommendations (overprovisioned / underprovisioned detection)
- Namespace-level aggregated view
- Auto-refresh interval selector
- Export as CSV/JSON
