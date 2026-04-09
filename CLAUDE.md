# KubeAdjust — CLAUDE.md

Context file for Claude Code. Covers architecture, commands, conventions, and known issues.

---

## Project Overview

KubeAdjust is a **read-only Kubernetes dashboard** (Go backend + Next.js frontend) that shows resource usage and optimization suggestions. It forwards the user's Kubernetes bearer token on every request — no server-side state, no database.

- **Backend**: Go 1.26, Chi v5 router, 3 production dependencies (chi, cors, errgroup), raw HTTP K8s API (no client-go)
- **Frontend**: Next.js 16, React 19, TypeScript 5, no UI library, no charting library
- **Infra**: Helm chart moved to [kubeadjust-helm](https:²/github.com/Thomas6013/kubeadjust-helm) (separate repo, independent versioning, published via GitHub Pages). Multi-stage Docker builds (amd64 + arm64), GitHub Actions CI with linting + tests + SBOM + cosign. Docker images publish on `v*.*.*` tag push only (not on every merge to main).

---

## Repository Layout

```
backend/
  main.go                  # Chi router, CORS (configurable via ALLOWED_ORIGINS), routes
  k8s/client.go            # Raw HTTP K8s API client (shared transport, token forwarding, LimitReader)
  k8s/types.go             # K8s API response types (extracted from client.go in v0.23.0)
  prometheus/client.go     # Optional Prometheus client (LimitReader, TimeRange, namespace batch)
  middleware/auth.go       # Bearer token extraction from Authorization header (token mode)
  middleware/cluster.go    # ClusterURL middleware — routes X-Cluster header to API server URL
  middleware/session.go    # SessionAuth middleware (OIDC mode) — validates session JWT, injects SA token
  oidc/session.go          # HS256 session JWT creation/verification + state generation (stdlib only)
  oidc/session_test.go     # Unit tests: CreateSessionToken, VerifySessionToken, GenerateState
  handlers/clusters.go     # ListClusters — returns configured cluster names (no auth required)
  handlers/oidc.go         # AuthConfig, LoginURL, CreateSession — public OIDC endpoints
  handlers/oidc_test.go    # Unit tests: AuthConfig handler
  main_test.go             # Unit tests: parseClusters, parseSATokens
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
    namespaces.go          # ListNamespaces + GetNamespaceStats — filters empty namespaces, aggregates limit/request ratios
    prometheus.go          # PromQL proxy + namespace batch history endpoint
  middleware/
    session_test.go        # Unit tests: extractSessionToken, SessionAuth middleware (6 cases)

frontend/
  src/app/page.tsx         # Login page (token form OR SSO button depending on OIDC_ENABLED)
  src/app/dashboard/       # Main dashboard (persistent state: view, ns, timeRange, openCards)
  src/app/api/[...path]/   # Runtime API proxy (reads BACKEND_URL at runtime, not build time)
  src/app/auth/login/      # Server-side route: gets OIDC auth URL, sets oidc-state cookie, redirects
  src/app/auth/callback/   # Server-side route: validates state, exchanges code, passes token to client
  src/app/auth/done/       # Client component: moves token from cookie → sessionStorage → /dashboard
  src/app/auth/logout/     # Client component: clears all kube-token*, kube-cluster, kubeadjust:* from sessionStorage → /
  src/lib/api.ts           # Typed API client (TimeRange, ContainerHistory, NamespaceHistoryResponse, AuthConfig, fmtRawValue)
  src/lib/suggestions.ts   # Suggestion computation (P95/mean weighted, no-limit warning, confidence indicator)
  src/lib/status.ts        # Shared STATUS_COLOR, STATUS_LABEL, shortPodName() (deduplicated from components)
  src/lib/storage.ts       # sessionStorage safe helpers (safeGetItem, safeSetItem, safeRemoveItem, STORAGE_KEYS)
  src/hooks/useSessionState.ts  # SessionStorage-backed dashboard preferences (view, autoRefresh, selectedNs, etc.)
  src/components/          # ResourceBar, PodRow, DeploymentCard, SuggestionPanel, Sparkline, Sidebar, Topbar, CircleGauge, PodBar
  src/proxy.ts             # Next.js proxy (nonce-based CSP per request)
  eslint.config.mjs        # ESLint 9 flat config (eslint-config-next + typescript)
  next.config.mjs          # Standalone output, security headers (CSP handled by proxy.ts)

docs/
  AUDIT.md                 # Technical audit: security, performance, code quality (v0.22.0)
  oidc.md                  # OIDC/SSO setup guide (Keycloak, Dex, Azure AD, Okta, Google)
  multi-cluster.md         # Multi-cluster configuration guide

deploy/
  viewer-serviceaccount.yaml  # Standalone SA + ClusterRole for remote clusters (still used in SA token setup docs)

.github/workflows/
  ci.yml                   # go build/vet/test + golangci-lint + npm typecheck/build/lint
  docker-publish.yml       # Push to GHCR (amd64+arm64) + SBOM + cosign signing

# Helm chart — separate repository
# https://github.com/Thomas6013/kubeadjust-helm
# helm repo add kubeadjust https://thomas6013.github.io/kubeadjust-helm
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

# Helm (production) — chart is now in https://github.com/Thomas6013/kubeadjust-helm
helm repo add kubeadjust https://thomas6013.github.io/kubeadjust-helm
helm repo update
helm upgrade --install kubeadjust kubeadjust/kubeadjust \
  --set ingress.enabled=true \
  --set ingress.host=kubeadjust.your-domain.com
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
| `OIDC_ENABLED` | `false` | Enable OIDC authentication (replaces manual token entry) |
| `OIDC_ISSUER_URL` | _(empty)_ | OIDC provider issuer URL (e.g. `https://keycloak.../realms/myrealm`) |
| `OIDC_CLIENT_ID` | _(empty)_ | OIDC client ID |
| `OIDC_CLIENT_SECRET` | _(empty)_ | OIDC client secret (store in K8s Secret) |
| `OIDC_REDIRECT_URL` | _(empty)_ | Must match `https://<frontend-host>/auth/callback` |
| `SESSION_SECRET` | _(empty)_ | ≥32-char secret for signing session JWTs (store in K8s Secret) |
| `SA_TOKEN` | _(empty)_ | Service Account token for default/single cluster (OIDC mode) |
| `SA_TOKENS` | _(empty)_ | SA tokens for named clusters: `prod=token1,staging=token2` (OIDC mode) |

---

## Security Model

### Token mode (default, `OIDC_ENABLED=false`)
- The user's Kubernetes token is stored in `sessionStorage` (frontend) and forwarded as `Authorization: Bearer` on every backend request. The backend never persists it.
- The backend acts as a transparent proxy — all K8s API permissions are those of the user's token.

### OIDC mode (`OIDC_ENABLED=true`)
- The user authenticates via an OIDC provider (Keycloak, Dex, Google, etc.). The OIDC client secret stays on the backend.
- After authentication, the backend issues a signed HS256 session JWT (8h TTL, `SESSION_SECRET`). It is stored in `sessionStorage` under the same `kube-token:<cluster>` key used in token mode — no change to the frontend API layer.
- The session JWT is validated by `middleware/session.go` on every request. A pre-configured Service Account token is then substituted into the context; all downstream handlers are unchanged.
- All K8s API calls use the SA token — this is a shared credential (no per-user K8s RBAC). Acceptable for read-only dashboards.
- OIDC flow: browser → `/auth/login` (Next.js server route) → provider → `/auth/callback` (Next.js server route) → `/auth/done` (client page, moves token to sessionStorage, redirects to `/?error=auth_failed` if sessionStorage unavailable) → `/dashboard`.
- OIDC public endpoints (`/api/auth/loginurl`, `/api/auth/session`) are rate-limited to 10 concurrent requests via Chi Throttle.
- OIDC provider discovery uses a 10s timeout to prevent hanging at startup.
- Every successful OIDC session creation is logged server-side with subject and remote addr for audit.
- At startup, warns if any configured cluster has no matching SA token (helps diagnose misconfiguration).
- Group-based access control: `OIDC_GROUPS` env var (comma-separated) — user must belong to at least one group. Checked server-side after JWKS verification. HTTP 403 on mismatch; frontend shows distinct "Access denied" message. Case-sensitive exact match against `groups` claim in ID token. When unset, startup WARN logged.
- The OIDC state parameter is validated (stored in httpOnly `oidc-state` cookie, max 5 min) to prevent CSRF attacks.
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

> Resolved items are archived in [ClaudeDone.md](ClaudeDone.md).

### Security — Medium Priority

- **Base images without digest pinning** — `backend/Dockerfile`, `frontend/Dockerfile`
  - `golang:1.26-alpine` and `node:25-alpine` use floating tags. Supply chain risk. Fix: pin with `@sha256:...`.

- **`KUBE_INSECURE_TLS` is global, not per-cluster** — `k8s/client.go:19`
  - `sharedTransport` reads the flag once at package init. If one cluster needs insecure TLS, all clusters get it. Fix: per-cluster TLS config or per-client transport.

- **Missing `seccompProfile: RuntimeDefault`** — `helm/kubeadjust/templates/deployment.yaml`
  - Neither backend nor frontend pod specs set seccomp profile. Fix: add `seccompProfile.type: RuntimeDefault` to both.

- **Missing `fsGroup` on pod security contexts** — `helm/kubeadjust/templates/deployment.yaml`
  - Fix: add `fsGroup: 65534` (backend) and `fsGroup: 1001` (frontend).

- **Frontend `/tmp` emptyDir has no size limit** — `helm/kubeadjust/templates/deployment.yaml:133`
  - Can grow unbounded and evict pod. Fix: add `sizeLimit: 100Mi`.

### Performance — Medium Priority

- **N+1 kubelet calls per node** — `handlers/resources.go:115-161`
  - `GetNodeSummary()` called per node. Fix: batch or cache with short TTL.

- **No virtualisation/pagination for large clusters** — `dashboard/page.tsx`
  - 100+ workloads render in a single list. Fix: react-window or "load more" pagination.

### Robustness — Medium Priority

- **Helm chart not linted in CI** — `.github/workflows/ci.yml`
  - Fix: add `helm lint helm/kubeadjust` and optionally `ct lint`.

- **Session JWT 8h with no refresh** — `oidc/session.go`
  - User loses session after 8h with no warning or extend-on-activity. Fix: refresh token or session extension mechanism.

### Testing — Medium Priority

- **No tests for backend handlers or K8s client** — `handlers/auth.go`, `handlers/nodes.go`, `handlers/resources.go`, `handlers/namespaces.go`, `k8s/client.go`, `prometheus/client.go`
  - K8s API orchestration and retry logic untested. Fix: add unit tests with mock HTTP server.

- **No tests for frontend components** — `PodRow.tsx`, `DeploymentCard.tsx`, `NodeCard.tsx`, `SuggestionPanel.tsx`, `ResourceBar.tsx`, `Sidebar.tsx`
  - All components untested; visual regressions and type errors only caught at runtime. Fix: add vitest + @testing-library/react tests.

### Maintainability — Low Priority

- **Suggestion thresholds hardcoded** — `suggestions.ts`
  - 0.90, 0.70, 0.35, 3× not configurable. Fix: extract to config object.

### Accessibility — Low Priority

- **No `:focus-visible` styles on interactive elements** — multiple CSS modules
  - Buttons have `:hover` but no focus indicator for keyboard users. Fix: add `:focus-visible` outlines.

- **`button:disabled` uses only `opacity: 0.4`** — `globals.css:43`
  - No `cursor: not-allowed`. Fix: add cursor style for disabled state.

- **Sidebar has fixed 200px width, no responsive collapse** — `dashboard.module.css:170`
  - Fix: add responsive breakpoint to collapse/hide sidebar on mobile.

### Font/CSS Consistency — Low Priority

- **Inconsistent font size scale** — multiple CSS modules
  - Arbitrary sizes: 9px, 10px, 11px, 12px, 13px, 14px, 16px, 20px, 22px, 28px. Fix: define a type scale with CSS custom properties.

- **Taint colors hardcoded in JS instead of CSS** — `NodeCard.tsx:49-58`
  - `TAINT_EFFECT_COLOR` and `TAINT_EFFECT_BORDER` are RGBA literals. Fix: move to CSS custom properties.

---

## Code Conventions

- **No client-go**: raw `net/http` calls to the K8s API only. Do not add `k8s.io/client-go`.
- **No CSS frameworks**: CSS Modules only (`*.module.css`). No Tailwind, no MUI.
- **No charting libraries**: SVG sparklines hand-rolled. No Chart.js, Recharts, etc.
- **Versioning**: follow [Semantic Versioning](https://semver.org/). Three files to update on every release: `frontend/src/lib/version.ts` (`APP_VERSION`), `frontend/package.json` (`version`), and `appVersion` in the [kubeadjust-helm](https://github.com/Thomas6013/kubeadjust-helm) Chart.yaml (separate repo — `helm/` no longer exists here). Keep CHANGELOG.md, CLAUDE.md, and README.md aligned. Docker images publish only when a `*.*.*` git tag is pushed (`git tag 0.24.0 && git push origin 0.24.0`).
- **RBAC**: keep the ClusterRole strictly read-only. Any new K8s resource access needs a `get`/`list`/`watch` verb only.
- **Error handling**: never return raw K8s API errors to HTTP clients. Log server-side with `log.Printf`, return generic messages.
- **Token safety**: never log, store, or cache the bearer token.
- **Parallelism**: use `golang.org/x/sync/errgroup` for concurrent K8s API calls. Use `SetLimit()` to bound kubelet/node calls.
- **State persistence**: dashboard state (view, namespace, timeRange, openCards, excludedNs) persisted in `sessionStorage`. Always restore in `useEffect` (not `useState` initializer) to avoid SSG errors. Navigation state (`cluster`, `view`, `ns`) is also reflected in URL query params for shareability; priority on load: URL param > sessionStorage > default.
- **K8s API retry**: `k8s/client.go` retries up to 3 times with exponential backoff on 5xx/network errors. 4xx errors (auth, not-found) fail immediately.

---

## CI/CD Notes

- `ci.yml` runs on push/PR to `main`: `go build`, `go vet`, `go test`, `golangci-lint`, `npm ci`, `npm run typecheck` (`tsc --noEmit`), `npm run build`, `npm run lint`. Skipped for `renovate[bot]` PRs (`if: github.actor != 'renovate[bot]'` on both jobs).
- `docker-publish.yml` builds and pushes to `ghcr.io/thomas6013/kubeadjust/` on `*.*.*` tag push only (not on every merge to `main`).
- Image tags: `latest`, `<git-tag>` (authoritative version from `$GITHUB_REF_NAME`), `<commit-sha>`.
- Multi-arch: `linux/amd64` + `linux/arm64` via QEMU + buildx. Backend uses native Go cross-compilation (`BUILDPLATFORM`/`TARGETARCH`).
- SBOM generated per image with `anchore/sbom-action` (SPDX format).
- Images signed with `sigstore/cosign` (keyless, OIDC-based).
- Renovate is configured but only applies dependency updates (no custom rules yet).

---

## Definition of Done (Release Checklist)

Before merging a feature branch and tagging a release, every item below must be complete.

### Build & tests
- `cd backend && go build ./...` — no errors
- `cd backend && go vet ./...` — no warnings
- `cd backend && go test ./...` — all tests pass
- `cd frontend && npm run typecheck` — no type errors (`tsc --noEmit`)
- `cd frontend && npm run build` — no build errors
- `cd frontend && npm run lint` — no lint errors

### Version bump (3 files — all three, every time)
- `frontend/src/lib/version.ts` — update `APP_VERSION` (drives topbar badge)
- `frontend/package.json` — update `version` field (easy to forget — was stuck at `0.2.0` until v0.22.0, then missed again in 0.23.0)
- `appVersion` in [kubeadjust-helm](https://github.com/Thomas6013/kubeadjust-helm) `Chart.yaml` (separate repo)

### Documentation
- `CHANGELOG.md` — all changes documented under the new version; change date from `unreleased` to `YYYY-MM-DD`
- `CLAUDE.md` — Known Issues: move every item resolved this version to `ClaudeDone.md` under a new `## vX.Y.Z` heading
- `README.md` — update if user-facing features, env vars, or architecture changed

### Git workflow
1. All changes committed on the feature branch
2. PR reviewed and merged into `main`
3. Tag pushed from `main` to trigger Docker publish: `git tag 0.X.Y && git push origin 0.X.Y`
4. Helm chart version bumped and tagged in [kubeadjust-helm](https://github.com/Thomas6013/kubeadjust-helm)

### Common pitfalls
- Helm chart is in a **separate repo** — `helm/` no longer exists in this repo; changes to chart values, RBAC, or deployment templates go there
- Docker images publish **only on tag push** (not on merge to main) — double-check the tag matches the version bumped in step above
- `frontend/package.json` `version` is not read at runtime but must stay in sync for `npm audit` and tooling consistency
- HTTP transports in `k8s/client.go` and `prometheus/client.go` are custom — always include `DialContext` with `KeepAlive: 30s` if creating a new one (see v0.24.0 stale-connection fix)

---

## Deployment Reminders

- Helm chart is now at [github.com/Thomas6013/kubeadjust-helm](https://github.com/Thomas6013/kubeadjust-helm). `helm repo add kubeadjust https://thomas6013.github.io/kubeadjust-helm`.
- The chart's `rbac.yaml` creates a `ClusterRoleBinding`. On RBAC-restricted clusters, the installer needs `cluster-admin` or equivalent.
- `KUBE_API_SERVER` must be reachable from within the cluster when deployed via Helm (use the cluster's internal API server URL, typically `https://kubernetes.default.svc`).
- `metrics-server` is an optional sub-chart. Enable with `metricsServer.enabled=true` only if not already deployed in the cluster.
- Set `ALLOWED_ORIGINS` in production to restrict CORS to your frontend domain.
- `BACKEND_URL` is auto-generated by Helm as FQDN (`<release>-backend.<namespace>:<port>`). No manual override needed.
- `PROMETHEUS_URL` can be set with or without `http://` scheme — the backend auto-prepends if missing.
