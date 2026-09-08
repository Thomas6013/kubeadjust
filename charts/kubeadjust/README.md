# kubeadjust-helm

> Official Helm chart for [KubeAdjust](https://github.com/Thomas6013/kubeadjust) — a read-only Kubernetes resource dashboard.

[![Lint](https://github.com/Thomas6013/kubeadjust-helm/actions/workflows/lint.yml/badge.svg)](https://github.com/Thomas6013/kubeadjust-helm/actions/workflows/lint.yml)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Helm](https://img.shields.io/badge/helm-%E2%89%A53.x%20%7C%204.x-0F1689.svg)](https://helm.sh/)
[![Kubernetes](https://img.shields.io/badge/kubernetes-%E2%89%A51.21-326CE5.svg)](https://kubernetes.io/)

KubeAdjust shows CPU/memory requests, limits, and actual usage for every workload — with right-sizing suggestions based on Prometheus P95 data. It **never modifies your cluster**.

---

## Install

```bash
git clone https://github.com/Thomas6013/kubeadjust-helm.git
helm install kubeadjust kubeadjust-helm/charts/kubeadjust \
  --namespace kubeadjust --create-namespace \
  --set ingress.enabled=true \
  --set ingress.host=kubeadjust.your-domain.com
```

Or directly from the cloned directory:

```bash
helm upgrade --install kubeadjust charts/kubeadjust \
  --namespace kubeadjust --create-namespace
```

Get a login token:

```bash
kubectl create token kubeadjust -n kubeadjust
```

---

## Configuration

### Core values

| Value | Default | Description |
|---|---|---|
| `backend.image.repository` | `ghcr.io/thomas6013/kubeadjust/kubeadjust-backend` | Backend image |
| `backend.image.tag` | _(chart appVersion)_ | Pin to a specific version |
| `backend.replicaCount` | `1` | Backend replicas |
| `backend.port` | `8080` | Backend port |
| `backend.allowedOrigins` | `""` | CORS origins (set to your frontend URL in production) |
| `backend.clusters` | `{}` | Multi-cluster: `{prod: url, staging: url}` |
| `backend.env` | `[]` | Extra env vars (e.g. `KUBE_INSECURE_TLS: "true"`) |
| `backend.resources` | `50m/64Mi` · `200m/128Mi` | Requests / limits |
| `frontend.image.repository` | `ghcr.io/thomas6013/kubeadjust/kubeadjust-frontend` | Frontend image |
| `frontend.image.tag` | _(chart appVersion)_ | Pin to a specific version |
| `frontend.replicaCount` | `1` | Frontend replicas |
| `frontend.resources` | `50m/128Mi` · `200m/256Mi` | Requests / limits |
| `serviceAccount.create` | `true` | Create a ServiceAccount |
| `rbac.create` | `true` | Create read-only ClusterRole + ClusterRoleBinding |
| `ingress.enabled` | `false` | Enable Ingress |
| `ingress.className` | `""` | Ingress class (e.g. `nginx`) |
| `ingress.host` | `kubeadjust.example.com` | Ingress hostname |
| `ingress.tls` | `[]` | TLS config |
| `metrics-server.enabled` | `false` | Deploy metrics-server sub-chart |
| `prometheus.enabled` | `false` | Enable Prometheus integration |
| `prometheus.url` | `""` | Prometheus URL |
| `networkPolicy.enabled` | `false` | Enable NetworkPolicy |

### OIDC / SSO

| Value | Default | Description |
|---|---|---|
| `oidc.enabled` | `false` | Enable OIDC login |
| `oidc.issuerUrl` | `""` | OIDC issuer URL |
| `oidc.clientId` | `""` | OIDC client ID |
| `oidc.redirectUrl` | `""` | `https://<host>/auth/callback` |
| `oidc.groups` | `""` | Allowed OIDC groups (comma-separated, empty = all) |
| `oidc.existingSecret` | `""` | Existing secret with `clientSecret` + `sessionSecret` |
| `oidc.saTokens` | `{}` | SA tokens per cluster: `{prod: token, staging: token}` |
| `oidc.existingTokenSecret` | `""` | Existing secret with SA tokens — keys must match `backend.clusters` names |

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

See `deploy/` for more example Secret manifests.

---

## Upgrade

```bash
git pull
helm upgrade kubeadjust charts/kubeadjust -n kubeadjust
```

## Uninstall

```bash
helm uninstall kubeadjust -n kubeadjust
```

---

## Security

Read-only by design — see [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## License

Apache 2.0 — see [LICENSE](LICENSE).
