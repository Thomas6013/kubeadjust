# KubeAdjust — CLAUDE.md

Context file for Claude Code. Covers architecture, commands, conventions, and known issues.

---

## Project Overview

KubeAdjust is a **read-only Kubernetes dashboard** (Go backend + Next.js frontend) that shows resource usage and optimization suggestions. It forwards the user's Kubernetes bearer token on every request — no server-side state, no database.

- **Backend**: Go 1.22, Chi v5 router, 3 production dependencies (chi, cors, errgroup), raw HTTP K8s API (no client-go)
- **Frontend**: Next.js 16, React 19, TypeScript 5, no UI library, no charting library
- **Infra**: Helm chart (v0.15.0), multi-stage Docker builds (amd64 + arm64), GitHub Actions CI with linting + tests + SBOM + cosign

---

## Repository Layout

```
backend/
  main.go                  # Chi router, CORS (configurable via ALLOWED_ORIGINS), routes
  k8s/client.go            # Raw HTTP K8s API client (shared transport, token forwarding, LimitReader)
  prometheus/client.go     # Optional Prometheus client (LimitReader, TimeRange, namespace batch)
  middleware/auth.go       # Bearer token extraction from Authorization header
  middleware/cluster.go    # ClusterURL middleware — routes X-Cluster header to API server URL
  handlers/clusters.go     # ListClusters — returns configured cluster names (no auth required)
  resources/
    types.go               # Shared response types (ResourceValue, PodDetail, NodeOverview, etc.)
    parse.go               # ParseCPUMillicores, ParseMemoryBytes, ParseResource, ParseStorageBytes
    parse_test.go          # Unit tests for resource parsing
    format.go              # FmtBytes, FmtMillicores
    workloads.go           # BuildOwnerMaps, BuildPodDetails (pure calculation)
    nodes.go               # NodeRoles, NodeStatus (pure calculation)
    validate.go            # IsValidLabelValue (PromQL injection prevention)
    validate_test.go       # Unit tests for label validation
  handlers/
    auth.go                # Token validation handler (generic error messages)
    resources.go           # ListDeployments — K8s API orchestration, delegates to resources/
    nodes.go               # ListNodes — K8s API orchestration, delegates to resources/
    namespaces.go          # ListNamespaces — filters empty namespaces (parallel pod check)
    prometheus.go          # PromQL proxy + namespace batch history endpoint

frontend/
  src/app/page.tsx         # Login page (token → sessionStorage)
  src/app/dashboard/       # Main dashboard (persistent state: view, ns, timeRange, openCards)
  src/app/api/[...path]/   # Runtime API proxy (reads BACKEND_URL at runtime, not build time)
  src/lib/api.ts           # Typed API client (TimeRange, ContainerHistory, NamespaceHistoryResponse)
  src/lib/suggestions.ts   # Suggestion computation (P95/mean weighted, no-limit warning, confidence indicator)
  src/components/          # ResourceBar, PodRow, DeploymentCard, SuggestionPanel, Sparkline
  src/proxy.ts             # Next.js proxy (nonce-based CSP per request)
  next.config.mjs          # Standalone output, security headers (CSP handled by proxy.ts)

helm/kubeadjust/
  Chart.yaml               # Source of truth for version (appVersion: "0.14.0")
  values.yaml              # Defaults: 1 replica, 50m CPU, 64/128Mi mem
  templates/
    deployment.yaml        # Backend + frontend deployments, FQDN BACKEND_URL, security contexts
    rbac.yaml              # Read-only ClusterRole (no write permissions ever)
    networkpolicy.yaml     # Optional NetworkPolicy (networkPolicy.enabled=true)

deploy/
  viewer-serviceaccount.yaml  # Standalone SA + ClusterRole for remote clusters

.github/workflows/
  ci.yml                   # go build/vet/test + golangci-lint + npm build/lint
  docker-publish.yml       # Push to GHCR (amd64+arm64) + SBOM + cosign signing
```

---

## Key Commands

```bash
# Backend
cd backend && go build ./...
cd backend && go vet ./...
cd backend && go test ./...

# Frontend
cd frontend && npm ci
cd frontend && npm run build
cd frontend && npm run lint

# Full stack local dev
docker compose up --build

# Helm (production)
helm upgrade --install kubeadjust ./helm/kubeadjust \
  --set backend.kubeApiServer=https://your-k8s-api \
  --set backend.kubeInsecureTls=false \
  --set backend.allowedOrigins=https://your-frontend-domain.com
```

---

## Environment Variables

See `.env.example` at repo root. Key variables:

| Variable | Default | Description |
|---|---|---|
| `KUBE_API_SERVER` | `https://kubernetes.default.svc` | K8s API server URL (single-cluster mode) |
| `CLUSTERS` | _(empty)_ | Multi-cluster: `prod=https://...,staging=https://...` |
| `KUBE_INSECURE_TLS` | `false` | Skip TLS verification (logs warning at startup) |
| `ALLOWED_ORIGINS` | `*` (with warning) | Comma-separated CORS origins (whitespace-trimmed) |
| `PROMETHEUS_URL` | _(empty)_ | Prometheus base URL (auto-prepends `http://` if scheme missing) |
| `BACKEND_URL` | auto-generated from Helm | Frontend → backend proxy (FQDN: `<release>-backend.<namespace>:<port>`) |
| `PORT` | `8080` | Backend listen port |

---

## Security Model

- The user's Kubernetes token is stored in `sessionStorage` (frontend) and forwarded as `Authorization: Bearer` on every backend request. The backend never persists it.
- The backend acts as a transparent proxy — all K8s API permissions are those of the user's token.
- The Helm ClusterRole is read-only (no `create`, `update`, `delete`, `patch`). **Never add write permissions.**
- Token is never logged server-side (verified: no `log.*token` in any Go file).
- PromQL injection is prevented via `isValidLabelValue()` in `handlers/prometheus.go` — whitelist `[a-zA-Z0-9._-]`.
- All K8s API errors are logged server-side only — generic messages returned to clients.
- Response bodies capped at 10 MB via `io.LimitReader` (K8s + Prometheus clients).
- CORS origins configurable via `ALLOWED_ORIGINS` env var (defaults to `*` with startup warning).
- CSP is nonce-based (per-request) via `src/proxy.ts` — no `'unsafe-inline'` or `'unsafe-eval'` in `script-src`.
- Path traversal (`../`, `//`, null bytes) rejected in the frontend API proxy.
- X-Frame-Options + X-Content-Type-Options + Referrer-Policy set in `next.config.mjs`.
- Frontend API proxy (`/api/[...path]/route.ts`) reads `BACKEND_URL` at runtime — no build-time baking.
- Docker images signed with cosign, SBOM generated with anchore/sbom-action.
- Multi-arch builds (amd64 + arm64) with QEMU + native Go cross-compilation.

---

## Known Issues & Backlog

### Security — High Priority

_(All High priority issues resolved in v0.14.0 — see Resolved section below.)_

### Performance — Medium Priority

- **`ListAllPods` fetches all cluster pods per `/api/nodes` request** — `handlers/nodes.go`
  - Fix: short TTL in-memory cache (30s), or field-selector to exclude terminated pods.

- **No virtualisation/pagination for large clusters** — `dashboard/page.tsx`
  - 100+ workloads render in a single list. Fix: react-window or "load more" pagination.

- **No retry on transient K8s API failures** — `k8s/client.go`
  - Single network hiccup = request failure. Fix: exponential backoff (max 3 attempts, 5xx only).

### Performance — Low Priority

- **Sparkline min/max recalculated every render** — `Sparkline.tsx`
  - Fix: wrap in `useMemo`.

- **No connection pooling on Prometheus client** — `prometheus/client.go`
  - Fix: custom Transport with `MaxIdleConnsPerHost: 10`.

### Robustness — Medium Priority

- **Helm chart not linted in CI** — `.github/workflows/ci.yml`
  - Fix: add `helm lint helm/kubeadjust` and optionally `ct lint`.

- **ESLint disabled in CI** — `.github/workflows/ci.yml`
  - `next lint` removed in Next.js 16. Fix: configure `eslint .` directly.

### Robustness — Low Priority

- **`openCards` sessionStorage can grow unbounded** — `dashboard/page.tsx`
  - Fix: cap at ~100 entries, or clear on namespace switch.

- **sessionStorage writes not wrapped in try-catch** — `dashboard/page.tsx`
  - Fix: wrap all `sessionStorage.setItem` for `QuotaExceededError`.

- **Silent `.catch(() => {})` on background fetches** — `dashboard/page.tsx`
  - Fix: `console.warn` in dev, optional UI indicator when Prometheus fails.

### Maintainability — Low Priority

- **Magic strings for sessionStorage keys** — `dashboard/page.tsx`
  - Fix: extract to `const STORAGE_KEYS = { ... }`.

- **`parseMemoryBytes` reused to parse pod count** — `handlers/nodes.go`
  - Semantically fragile. Fix: dedicated `parsePodCount()`.

- **Suggestion thresholds hardcoded** — `suggestions.ts`
  - 0.90, 0.70, 0.35, 3× not configurable. Fix: extract to config object.

- **Inconsistent errgroup initialisation** — `handlers/resources.go` vs `handlers/namespaces.go`
  - Some use `errgroup.WithContext()`, others `new(errgroup.Group)`. Fix: standardise.

### Resolved

- ~~Taint display on node view~~ — RESOLVED (v0.15.0, colored badges per effect in node card header).
- ~~No per-pod resource overview on node view~~ — RESOLVED (v0.15.0, auto-fetch + horizontal bar diagram per pod, no click needed).
- ~~No sparkline zoom~~ — RESOLVED (v0.15.0, click sparkline → modal with time axis, min/max, current).
- ~~No pod filter for suggestions~~ — RESOLVED (v0.15.0, ⊕ button on pod row + filter bar in SuggestionPanel).
- ~~Clicking suggestion doesn't open pod row~~ — RESOLVED (v0.15.0, opens dep card + pod row, scrolls to container).
- ~~Native `<select>` for cluster list on login page~~ — RESOLVED (v0.15.0, card grid buttons).
- ~~No cluster switcher on dashboard~~ — RESOLVED (v0.15.0, dropdown on cluster badge in topbar).
- ~~No workload/pod search in namespace view~~ — RESOLVED (v0.15.0, search input above deployment list).
- ~~SuggestionGroup open/close state resets on namespace switch / auto-refresh~~ — RESOLVED (v0.15.0, state lifted to parent as `Map<string, boolean>`).
- ~~Clicking suggestion item doesn't open target DeploymentCard~~ — RESOLVED (v0.15.0, `onOpenCard` callback).
- ~~No suggestion when request is too low vs actual usage~~ — RESOLVED (v0.15.0, "request too low" warning/danger when P95 > request × 1.1).
- ~~CSP uses `'unsafe-inline'` and `'unsafe-eval'`~~ — RESOLVED (v0.14.0, nonce-based CSP via `src/proxy.ts`).
- ~~No path validation in frontend proxy~~ — RESOLVED (v0.14.0, rejects `..`, `//`, null bytes).
- ~~No NetworkPolicy in Helm chart~~ — RESOLVED (v0.14.0, optional `networkPolicy.enabled`).
- ~~`ALLOWED_ORIGINS` not in Helm deployment template~~ — RESOLVED (v0.14.0, `backend.allowedOrigins` value).
- ~~CORS origin split doesn't trim whitespace~~ — RESOLVED (v0.14.0, `strings.TrimSpace()` in `main.go`).
- ~~Frontend missing `readOnlyRootFilesystem`~~ — RESOLVED (v0.14.0, with `/tmp` emptyDir).
- ~~`ResourceBar.tsx` missing `"use client"` directive~~ — RESOLVED.
- ~~`SuggestionPanel` uses array index as React key~~ — RESOLVED (v0.8.0).
- ~~`BACKEND_URL` baked at build time~~ — RESOLVED (v0.13.0, runtime API proxy).
- ~~Suggestions based on snapshot only~~ — RESOLVED (v0.13.0, Prometheus P95/mean).
- ~~PodRow history waterfall fetch~~ — RESOLVED (v0.13.0, eager namespace-wide fetch).
- ~~No rate limiting~~ — RESOLVED (v0.13.0, Chi Throttle 20 concurrent).
- ~~No auto-clear of expired token on 401~~ — RESOLVED (v0.13.0, auto-logout + redirect).
- ~~Prometheus client created per request~~ — RESOLVED (v0.13.0, global singleton at startup).
- ~~`go mod tidy` in Dockerfile~~ — RESOLVED (v0.13.0, replaced with `go mod download`).
- ~~No `readinessProbe` on frontend~~ — RESOLVED (v0.13.0, added to Helm deployment).
- ~~Suggestion action labels wrong~~ — RESOLVED (v0.13.0, per-suggestion `action` field).
- ~~PromQL injection blacklist too weak~~ — RESOLVED (v0.13.0, whitelist `[a-zA-Z0-9._-]`).
- ~~LimitReader silent truncation~~ — RESOLVED (v0.13.0, explicit error + size check).
- ~~Namespace list non-deterministic order~~ — RESOLVED (v0.13.0, sorted before response).
- ~~Proxy drops query parameters~~ — RESOLVED (v0.13.0, appends `req.nextUrl.search`).
- ~~PodRow infinite fetch loop~~ — RESOLVED (v0.13.0, ref-based tracking).
- ~~Auth middleware returns text/plain~~ — RESOLVED (v0.13.0, JSON Content-Type).

---

## Code Conventions

- **No client-go**: raw `net/http` calls to the K8s API only. Do not add `k8s.io/client-go`.
- **No CSS frameworks**: CSS Modules only (`*.module.css`). No Tailwind, no MUI.
- **No charting libraries**: SVG sparklines hand-rolled. No Chart.js, Recharts, etc.
- **Versioning**: follow [Semantic Versioning](https://semver.org/). Bump `appVersion` in `helm/kubeadjust/Chart.yaml` — it is the single source of truth. CI reads it for Docker image tags. Keep CHANGELOG.md, CLAUDE.md, and README.md aligned on the current version.
- **RBAC**: keep the ClusterRole strictly read-only. Any new K8s resource access needs a `get`/`list`/`watch` verb only.
- **Error handling**: never return raw K8s API errors to HTTP clients. Log server-side with `log.Printf`, return generic messages.
- **Token safety**: never log, store, or cache the bearer token.
- **Parallelism**: use `golang.org/x/sync/errgroup` for concurrent K8s API calls. Use `SetLimit()` to bound kubelet/node calls.
- **State persistence**: dashboard state (view, namespace, timeRange, openCards, excludedNs) persisted in `sessionStorage`. Always restore in `useEffect` (not `useState` initializer) to avoid SSG errors.

---

## CI/CD Notes

- `ci.yml` runs on every push/PR: `go build`, `go vet`, `go test`, `golangci-lint`, `npm ci`, `npm run build`, `npm run lint`.
- `docker-publish.yml` builds and pushes to `ghcr.io/thomas6013/kubeadjust/` on merge to `main`.
- Image tags: `latest`, `<appVersion>` (from Chart.yaml), `<commit-sha>`.
- Multi-arch: `linux/amd64` + `linux/arm64` via QEMU + buildx. Backend uses native Go cross-compilation (`BUILDPLATFORM`/`TARGETARCH`).
- SBOM generated per image with `anchore/sbom-action` (SPDX format).
- Images signed with `sigstore/cosign` (keyless, OIDC-based).
- Renovate is configured but only applies dependency updates (no custom rules yet).

---

## Deployment Reminders

- The `helm/kubeadjust/templates/rbac.yaml` creates a `ClusterRoleBinding`. On RBAC-restricted clusters, the installer needs `cluster-admin` or equivalent.
- `KUBE_API_SERVER` must be reachable from within the cluster when deployed via Helm (use the cluster's internal API server URL, typically `https://kubernetes.default.svc`).
- `metrics-server` is an optional sub-chart. Enable with `metricsServer.enabled=true` only if not already deployed in the cluster.
- Set `ALLOWED_ORIGINS` in production to restrict CORS to your frontend domain.
- `BACKEND_URL` is auto-generated by Helm as FQDN (`<release>-backend.<namespace>:<port>`). No manual override needed.
- `PROMETHEUS_URL` can be set with or without `http://` scheme — the backend auto-prepends if missing.
