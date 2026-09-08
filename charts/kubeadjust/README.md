# KubeAdjust Helm chart

> Official Helm chart for [KubeAdjust](../../README.md) — a read-only Kubernetes resource dashboard.

[![CI](https://github.com/Thomas6013/kubeadjust/actions/workflows/helm-lint.yml/badge.svg)](https://github.com/Thomas6013/kubeadjust/actions/workflows/helm-lint.yml)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](../../LICENSE)
[![Helm](https://img.shields.io/badge/helm-%E2%89%A53.x%20%7C%204.x-0F1689.svg)](https://helm.sh/)
[![Kubernetes](https://img.shields.io/badge/kubernetes-%E2%89%A51.21-326CE5.svg)](https://kubernetes.io/)

KubeAdjust shows CPU/memory requests, limits, and actual usage for every workload — with
right-sizing suggestions based on Prometheus P95 data. It **never modifies your cluster**.

The chart version tracks the application version: chart `0.27.0` deploys app `0.27.0`. Both live
in this repository and are released together.

---

## Install

There is no Helm repository to add — install from the cloned path.

```bash
git clone https://github.com/Thomas6013/kubeadjust.git && cd kubeadjust

# Once per clone. Required even when metrics-server.enabled=false: Helm resolves
# every dependency before it evaluates the condition that would skip it.
helm repo add metrics-server https://kubernetes-sigs.github.io/metrics-server/
helm dependency build charts/kubeadjust

helm upgrade --install kubeadjust charts/kubeadjust \
  --namespace kubeadjust --create-namespace \
  --set ingress.enabled=true \
  --set ingress.host=kubeadjust.your-domain.com
```

`helm dependency build` uses the digest pinned in `Chart.lock`, so every clone resolves the same
metrics-server sub-chart. Use `helm dependency update` instead only when you intend to move that
pin — it rewrites `Chart.lock`.

Get a login token:

```bash
kubectl create token kubeadjust -n kubeadjust
```

---

## Configuration

### Naming

| Value | Default | Description |
|---|---|---|
| `nameOverride` | `""` | Override the chart name used in resource names and labels |
| `fullnameOverride` | `""` | Override the full release-prefixed resource name |

### Backend

| Value | Default | Description |
|---|---|---|
| `backend.image.repository` | `ghcr.io/thomas6013/kubeadjust/kubeadjust-backend` | Backend image |
| `backend.image.tag` | `""` (chart `appVersion`) | Set explicitly to pin a version |
| `backend.image.pullPolicy` | `Always` | Image pull policy |
| `backend.image.pullSecrets` | `[]` | `imagePullSecrets` for a private registry |
| `backend.replicaCount` | `1` | Backend replicas |
| `backend.port` | `8080` | Backend container/service port |
| `backend.allowedOrigins` | `""` | CORS origins. **Set this to your frontend URL in production** — empty lets the backend fall back to `*` |
| `backend.clusters` | `{}` | Multi-cluster: `{prod: url, staging: url}`. Empty = single-cluster via `KUBE_API_SERVER` |
| `backend.env` | `[]` | Extra env vars, e.g. `- name: KUBE_INSECURE_TLS` / `value: "true"` |
| `backend.resources` | `50m`/`64Mi` · `200m`/`128Mi` | Requests / limits |
| `backend.nodeSelector` | `{}` | Node selector for the backend Deployment |
| `backend.tolerations` | `[]` | Tolerations for the backend Deployment |
| `backend.affinity` | `{}` | Affinity rules for the backend Deployment |

### Frontend

| Value | Default | Description |
|---|---|---|
| `frontend.image.repository` | `ghcr.io/thomas6013/kubeadjust/kubeadjust-frontend` | Frontend image |
| `frontend.image.tag` | `""` (chart `appVersion`) | Set explicitly to pin a version |
| `frontend.image.pullPolicy` | `Always` | Image pull policy |
| `frontend.image.pullSecrets` | `[]` | `imagePullSecrets` for a private registry |
| `frontend.replicaCount` | `1` | Frontend replicas |
| `frontend.port` | `3000` | Frontend container port |
| `frontend.resources` | `50m`/`128Mi` · `200m`/`256Mi` | Requests / limits |
| `frontend.nodeSelector` | `{}` | Node selector for the frontend Deployment |
| `frontend.tolerations` | `[]` | Tolerations for the frontend Deployment |
| `frontend.affinity` | `{}` | Affinity rules for the frontend Deployment |

`BACKEND_URL` is not a value — the chart derives it as `<release>-backend.<namespace>:<port>`.

### Access control

| Value | Default | Description |
|---|---|---|
| `serviceAccount.create` | `true` | Create a ServiceAccount |
| `serviceAccount.name` | `""` | Use an existing ServiceAccount instead |
| `serviceAccount.annotations` | `{}` | Annotations on the ServiceAccount (e.g. an IRSA role ARN) |
| `rbac.create` | `true` | Create the read-only ClusterRole + ClusterRoleBinding |

The ClusterRole is fixed, not tunable: `get`/`list`/`watch` on namespaces, pods, PVCs, nodes,
`apps` workloads, `batch` jobs and `metrics.k8s.io`, plus `get` on `nodes/proxy`. It grants no
write verb. (A `rbac.role: viewer` value existed up to 0.26.0 and was read by nothing — it was
removed in 0.27.0.)

### Networking

| Value | Default | Description |
|---|---|---|
| `service.type` | `ClusterIP` | Service type for both Deployments |
| `ingress.enabled` | `false` | Enable Ingress |
| `ingress.className` | `""` | Ingress class (e.g. `nginx`) |
| `ingress.annotations` | `{}` | Ingress annotations (cert-manager, etc.) |
| `ingress.host` | `kubeadjust.example.com` | Ingress hostname |
| `ingress.tls` | `[]` | TLS config |
| `networkPolicy.enabled` | `false` | Restrict pod traffic to what the app needs. Requires a CNI that enforces NetworkPolicy |

### Metrics and Prometheus

| Value | Default | Description |
|---|---|---|
| `metrics-server.enabled` | `false` | Deploy the metrics-server sub-chart. Leave off if your cluster already has one |
| `metrics-server.args` | `[--kubelet-insecure-tls]` | Args passed to the sub-chart |
| `prometheus.enabled` | `false` | Enable Prometheus integration (sparklines + P95 suggestions) |
| `prometheus.url` | `""` | Prometheus URL, e.g. `http://prometheus-operated.monitoring.svc.cluster.local:9090` |
| `prometheus.port` | `9090` | Used only for the NetworkPolicy egress rule |

### OIDC / SSO

| Value | Default | Description |
|---|---|---|
| `oidc.enabled` | `false` | Enable OIDC login instead of the token form |
| `oidc.issuerUrl` | `""` | OIDC issuer URL |
| `oidc.clientId` | `""` | OIDC client ID |
| `oidc.redirectUrl` | `""` | `https://<host>/auth/callback` |
| `oidc.groups` | `""` | Allowed OIDC groups (comma-separated). Empty = any authenticated user — not recommended in production |
| `oidc.existingSecret` | `""` | Existing secret holding `clientSecret` + `sessionSecret`. When set, the two values below are ignored |
| `oidc.clientSecret` | `""` | Only when `existingSecret` is unset. Prefer a Secret over plain values |
| `oidc.sessionSecret` | `""` | Only when `existingSecret` is unset. Must be ≥32 chars |
| `oidc.existingTokenSecret` | `""` | Existing secret holding SA tokens — keys must match `backend.clusters` names. When set, `saTokens` is ignored |
| `oidc.saTokens` | `{}` | SA tokens per cluster: `{prod: token, staging: token}` |

---

## Examples

### Ingress with TLS

```yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  host: kubeadjust.example.com
  tls:
    - secretName: kubeadjust-tls
      hosts: [kubeadjust.example.com]

backend:
  allowedOrigins: "https://kubeadjust.example.com"
```

### Multi-cluster

```yaml
backend:
  clusters:
    prod: "https://k8s.prod.example.com:6443"
    staging: "https://k8s.staging.example.com:6443"
```

### With Prometheus

```yaml
prometheus:
  enabled: true
  url: "http://prometheus-operated.monitoring.svc.cluster.local:9090"
networkPolicy:
  enabled: true
```

### Pinning both Deployments to dedicated nodes

Placement is per-Deployment, so it is set twice — there is no shared block.

```yaml
backend:
  nodeSelector:
    node-role.kubernetes.io/infra: "true"
  tolerations:
    - key: dedicated
      operator: Equal
      value: infra
      effect: NoSchedule

frontend:
  nodeSelector:
    node-role.kubernetes.io/infra: "true"
  tolerations:
    - key: dedicated
      operator: Equal
      value: infra
      effect: NoSchedule
```

### OIDC / SSO

```yaml
oidc:
  enabled: true
  issuerUrl: "https://keycloak.example.com/realms/myrealm"
  clientId: "kubeadjust"
  redirectUrl: "https://kubeadjust.example.com/auth/callback"
  groups: "platform-team"
  existingSecret: "kubeadjust-oidc"
  existingTokenSecret: "kubeadjust-oidc-tokens"
```

### OIDC with existing SA token secret (multi-cluster)

When `existingTokenSecret` is set, `SA_TOKEN_<CLUSTER>` env vars are mounted automatically
from `backend.clusters` keys — no need to repeat them in `saTokens`:

```yaml
backend:
  clusters:
    prod: "https://k8s.prod.example.com:6443"
    staging: "https://k8s.staging.example.com:6443"

oidc:
  enabled: true
  existingTokenSecret: "kubeadjust-sa-tokens"
  # saTokens not needed — cluster names are taken from backend.clusters
```

Your secret must have keys matching the cluster names:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: kubeadjust-sa-tokens
  namespace: kubeadjust
type: Opaque
stringData:
  prod: "eyJhbGciOiJSUzI1NiJ9..."
  staging: "eyJhbGciOiJSUzI1NiJ9..."
```

See [`deploy/`](../../deploy) for ready-to-edit example Secret manifests.

---

## Upgrade

```bash
git pull
helm dependency build charts/kubeadjust   # only needed if Chart.lock changed
helm upgrade kubeadjust charts/kubeadjust -n kubeadjust
```

## Uninstall

```bash
helm uninstall kubeadjust -n kubeadjust
```

The ClusterRole and ClusterRoleBinding are owned by the release and go with it.

---

## Local validation

The same three commands CI runs, in [`helm-lint.yml`](../../.github/workflows/helm-lint.yml):

```bash
helm dependency build charts/kubeadjust
helm lint charts/kubeadjust --strict
helm template kubeadjust charts/kubeadjust > /dev/null
```

`helm lint --strict` reports one `[INFO] Chart.yaml: icon is recommended`. That is expected —
the project has no hosted logo URL to point at.

---

## Security

Read-only by design, enforced at every layer — see [SECURITY.md](../../SECURITY.md).

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md).

## License

Apache 2.0 — see [LICENSE](../../LICENSE).
