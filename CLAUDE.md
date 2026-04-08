# KubeAdjust — CLAUDE.md

Context file for Claude Code. Covers architecture, commands, conventions, and known issues.

---

## Project Overview

KubeAdjust is a **read-only Kubernetes dashboard** (Go backend + Next.js frontend) that shows resource usage and optimization suggestions. It forwards the user's Kubernetes bearer token on every request — no server-side state, no database.

- **Backend**: Go 1.26, Chi v5 router, 3 production dependencies (chi, cors, errgroup), raw HTTP K8s API (no client-go)
- **Frontend**: Next.js 16, React 19, TypeScript 5, no UI library, no charting library
- **Infra**: Helm chart moved to [kubeadjust-helm](https://github.com/Thomas6013/kubeadjust-helm) (separate repo, independent versioning, published via GitHub Pages). Multi-stage Docker builds (amd64 + arm64), GitHub Actions CI with linting + tests + SBOM + cosign. Docker images publish on `v*.*.*` tag push only (not on every merge to main).

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

### Bugs — High Priority

- ~~errgroup propagates best-effort errors~~ — RESOLVED (`handlers/resources.go` + `handlers/namespaces.go`: `_ = X.Wait()` replaced with proper `if err := X.Wait(); err != nil { log.Printf(...) }` pattern).
- ~~`sessionStorage.setItem()` not wrapped in try-catch~~ — RESOLVED (extracted `safeGetItem`/`safeSetItem`/`safeRemoveItem` in `src/lib/storage.ts`; all dashboard sessionStorage calls replaced).
- ~~Race condition in PodRow history fetch~~ — RESOLVED (`components/PodRow.tsx`: generation counter via `generationRef`; stale fetch results discarded on `timeRange` change).
- ~~NetworkPolicy missing Prometheus egress rule~~ — RESOLVED (`networkpolicy.yaml`: conditional egress rule added when `prometheus.enabled=true`; `prometheus.port` (default 9090) added to `values.yaml`).
- ~~`GetPodMetrics` ignores cluster URL in multi-cluster mode~~ — RESOLVED (v0.22.0, `handlers/resources.go`: `k8s.New(token, "")` → `k8s.New(token, middleware.ClusterURLFromContext(r.Context()))`; previously always queried the default cluster).
- ~~`abs64` missing in `resources` package~~ — RESOLVED (v0.23.0, `workloads.go` called `abs64()` for PVC capacity validation but the function was undefined; backend would not compile and all routes returned 500. Added to `resources/format.go`).

### Bugs — Medium Priority

- ~~Unsafe non-null assertion on `usage`~~ — RESOLVED (`NodeCard.tsx`: `usage!` → null guard with `"—"` fallback).
- ~~Unsafe `pop()!` on split result~~ — RESOLVED (`NodeCard.tsx`: `pop()!` → `pop() ?? t.key`).
- ~~`json.NewEncoder(w).Encode()` errors silently discarded~~ — RESOLVED (`jsonOK`/`jsonError` in `handlers/namespaces.go` and `handlers/auth.go` now check and log encode errors).
- ~~Comment references non-existent `src/middleware.ts`~~ — RESOLVED (`next.config.mjs:21` updated to `src/proxy.ts`).

- ~~PVC kubelet volume stats incorrect on shared filesystems~~ — RESOLVED (v0.23.0, `workloads.go`: kubelet `statfs()` returns total share capacity on NFS/CephFS, not per-PVC slice. Usage/available now only populated when reported filesystem capacity is within 10% of PVC capacity; otherwise omitted).
- ~~`SuggestionGroup` header button missing `type="button"`~~ — RESOLVED (v0.23.0, `SuggestionPanel.tsx`: untyped button could default to `type="submit"` in some browser contexts).

- ~~`ParseCPUMillicores` silently returns 0 on invalid input~~ — RESOLVED (v0.23.0, `resources/parse.go`: `log.Printf` warning on every invalid-input branch — nanocores, millicores, and float parsing. Uses `strings.CutSuffix` for cleaner suffix handling).
- ~~Silent `.catch(() => {})` on background fetches~~ — RESOLVED (v0.22.0, `dashboard/page.tsx`: three silent catches replaced with `console.warn(...)`).
- ~~Suggestion panel search clears unexpectedly when clicking a suggestion~~ — RESOLVED (v0.22.0, `dashboard/page.tsx`: `handleOpenCards` now checks `visibleDeployments.some(d => d.name === depName)` instead of `depName.includes(workloadSearch)`; was breaking pod-name-based searches and causing severity groups to reset to default-open).
- ~~Best-effort goroutine errors silently swallowed~~ — RESOLVED (v0.22.0, `handlers/resources.go`: six best-effort goroutines now `log.Printf` before returning nil — StatefulSets, CronJobs, ReplicaSets, Jobs, PodMetrics, PVCs).
- ~~`apiFetch` uses raw `sessionStorage` instead of `safeGetItem`~~ — RESOLVED (v0.22.0, `lib/api.ts`: `sessionStorage.getItem("kube-cluster")` replaced with `safeGetItem(STORAGE_KEYS.cluster)`).
- ~~Redundant `Succeeded`/`Failed` check in `GetNodePods`~~ — RESOLVED (v0.22.0, `handlers/nodes.go`: removed Go-side phase filter since `ListAllPods()` already excludes terminated pods via `fieldSelector`).
- ~~`QueryRange` duplicates `parseValues()` logic inline~~ — RESOLVED (v0.22.0, `prometheus/client.go`: inline parsing replaced with call to existing `parseValues()` function).
- ~~10 MB response cap hardcoded in 3 places~~ — RESOLVED (v0.22.0, `k8s/client.go` and `prometheus/client.go`: extracted `maxResponseBytes` constant).
- ~~`frontend/package.json` version stuck at `0.2.0`~~ — RESOLVED (v0.22.0, updated to `0.22.0`).

### Consistency — High Priority

- ~~Go version mismatch~~ — RESOLVED (`go.mod` bumped to `go 1.26`; matches Dockerfile and CI).
- ~~Node version mismatch~~ — RESOLVED (`ci.yml` updated to `node-version: "25"`; matches frontend Dockerfile).

### Security — Medium Priority

- **Base images without digest pinning** — `backend/Dockerfile`, `frontend/Dockerfile`
  - `golang:1.26-alpine` and `node:25-alpine` use floating tags. Supply chain risk. Fix: pin with `@sha256:...`.

- ~~K8s API path parameters not URL-encoded~~ — RESOLVED (`k8s/client.go`: `p()` helper using `url.PathEscape` applied to all 12 path-interpolated methods).

- **`KUBE_INSECURE_TLS` is global, not per-cluster** — `k8s/client.go:19`
  - `sharedTransport` reads the flag once at package init. If one cluster needs insecure TLS, all clusters get it. Fix: per-cluster TLS config or per-client transport.

- ~~No HTTPS validation on OIDC redirect URL~~ — RESOLVED (v0.23.0, `main.go`: `log.Fatal` at startup if `OIDC_REDIRECT_URL` does not start with `https://`).

- ~~`.env.example` incomplete for OIDC mode~~ — RESOLVED (v0.23.0, `.env.example`: expanded with all OIDC, multi-cluster, and SA token variables — commented-out sections with descriptions).

- **Missing `seccompProfile: RuntimeDefault`** — `helm/kubeadjust/templates/deployment.yaml`
  - Neither backend nor frontend pod specs set seccomp profile. Fix: add `seccompProfile.type: RuntimeDefault` to both.

- **Missing `fsGroup` on pod security contexts** — `helm/kubeadjust/templates/deployment.yaml`
  - Fix: add `fsGroup: 65534` (backend) and `fsGroup: 1001` (frontend).

- **Frontend `/tmp` emptyDir has no size limit** — `helm/kubeadjust/templates/deployment.yaml:133`
  - Can grow unbounded and evict pod. Fix: add `sizeLimit: 100Mi`.

- ~~Missing timezone data in scratch image~~ — RESOLVED (`backend/Dockerfile`: `/usr/share/zoneinfo` copied from builder stage).

### Performance — High Priority

- ~~No backend caching~~ — RESOLVED (v0.22.0, `k8s/cache.go`: generic TTL cache (`clusterCache[T]`) keyed by cluster URL. `ListAllPods`, `ListNodes`, `ListNodeMetrics`, `ListAllPodMetrics` cached 30s; `GetNodeSummary` cached 60s per node. Zero handler changes — fully transparent. Resolves the `GetNodePods` and `GetNamespaceStats` redundant cluster-wide fetch issues below.)

- ~~`GetNodePods` fetches all cluster pods + all metrics~~ — RESOLVED (v0.22.0, now served from `allPodsCache` and `allPodMetricsCache` on repeated calls within 30s).

- ~~`GetNamespaceStats` fetches all cluster pods~~ — RESOLVED (v0.22.0, `ListAllPods()` now hits `allPodsCache` — the cluster-wide fetch is shared with `/api/nodes` if called within the same 30s window).

### Performance — Medium Priority

- ~~`ListAllPods` fetches all cluster pods per `/api/nodes` request~~ — RESOLVED (v0.22.0: `fieldSelector` added to exclude terminated pods; v0.22.0: 30s TTL cache in `k8s/cache.go`).

- **N+1 kubelet calls per node** — `handlers/resources.go:115-161`
  - `GetNodeSummary()` called per node. Fix: batch or cache with short TTL.

- **No virtualisation/pagination for large clusters** — `dashboard/page.tsx`
  - 100+ workloads render in a single list. Fix: react-window or "load more" pagination.

- ~~No retry on transient K8s API failures~~ — RESOLVED (v0.21.0, `k8s/client.go`: up to 3 attempts with exponential backoff; 4xx errors fail immediately).

### Performance — Low Priority

- ~~Sparkline min/max recalculated every render~~ — RESOLVED (v0.22.0, `Sparkline.tsx` + `SparklineModal.tsx`: `useMemo` wraps all SVG coordinate derivations; constants moved to module scope).
- ~~No connection pooling on Prometheus client~~ — RESOLVED (v0.22.0, `prometheus/client.go`: custom `http.Transport` with `MaxIdleConnsPerHost: 10`).
- ~~`buildHistoryMap()` called every render in suggestions~~ — RESOLVED (v0.22.0, `SuggestionPanel.tsx`: `computeSuggestions` wrapped in `useMemo([deployments, history])`).

### Robustness — Medium Priority

- **Helm chart not linted in CI** — `.github/workflows/ci.yml`
  - Fix: add `helm lint helm/kubeadjust` and optionally `ct lint`.

- ~~ESLint disabled in CI~~ — RESOLVED (v0.21.0, ESLint 9 + `eslint-config-next` flat config; `npm run lint` runs `eslint src/`; CI step re-enabled).
- ~~CI runs on Renovate dependency-update PRs (wastes GitHub Actions minutes)~~ — RESOLVED (v0.23.0, `ci.yml`: `if: github.actor != 'renovate[bot]'` added to both `backend` and `frontend` jobs).

- ~~`docker-compose.yml` passes unused `BACKEND_URL` build arg~~ — RESOLVED (v0.21.0, build `args` block removed; runtime env var is sufficient).

### Robustness — Low Priority

- ~~`openCards` sessionStorage can grow unbounded~~ — RESOLVED (v0.24.0, `useSessionState.ts`: `.slice(0, 100)` caps saved cards at 100 entries).

- ~~Silent `.catch(() => {})` on background fetches~~ — RESOLVED (v0.22.0, replaced with `console.warn` in `dashboard/page.tsx`).

- ~~No loading indicator before first pod fetch in NodeCard~~ — RESOLVED (v0.24.0, `NodeCard.tsx`: "Loading pods…" shown whenever `podsOpen && pods === null`).

- ~~No React error boundaries~~ — RESOLVED (v0.24.0, `ErrorBoundary.tsx`: wraps main content area and suggestion panel independently; shows error message + Retry button on crash).

- **Session JWT 8h with no refresh** — `oidc/session.go`
  - User loses session after 8h with no warning or extend-on-activity. Fix: refresh token or session extension mechanism.

### Maintainability — Medium Priority

- ~~`dashboard/page.tsx` is 570 lines~~ — RESOLVED (v0.17.0: session state → `useSessionState.ts`; v0.21.0: sidebar → `Sidebar.tsx`; page reduced to ~545 lines).

- ~~`STATUS_COLOR` duplicated in 4 files~~ — RESOLVED (v0.21.0, extracted to `src/lib/status.ts`; `PodRow.tsx`, `ResourceBar.tsx`, `VolumeSection.tsx` now import from shared module).

- ~~`shortPodName()` duplicated in 3 files~~ — RESOLVED (v0.21.0, extracted to `src/lib/status.ts`; `PodRow.tsx`, `NodeCard.tsx` now import from shared module).

### Testing — Medium Priority

- **No tests for backend handlers or K8s client** — `handlers/auth.go`, `handlers/nodes.go`, `handlers/resources.go`, `handlers/namespaces.go`, `k8s/client.go`, `prometheus/client.go`
  - K8s API orchestration and retry logic untested. Fix: add unit tests with mock HTTP server.

- **No tests for frontend components** — `PodRow.tsx`, `DeploymentCard.tsx`, `NodeCard.tsx`, `SuggestionPanel.tsx`, `ResourceBar.tsx`, `Sidebar.tsx`
  - All components untested; visual regressions and type errors only caught at runtime. Fix: add vitest + @testing-library/react tests.

### Maintainability — Low Priority

- ~~Magic strings for sessionStorage keys~~ — RESOLVED (v0.21.0, `STORAGE_KEYS` in `lib/storage.ts`; v0.22.0: `apiFetch` also migrated to use `safeGetItem(STORAGE_KEYS.cluster)`).
- ~~CPU/MEM sort toggle in node view "Top pods"~~ — RESOLVED (v0.23.0, `NodeCard.tsx`: toggle buttons removed; sort fixed to CPU. CSS classes `sortToggle`/`sortBtn`/`sortBtnActive` removed from `NodeCard.module.css`).

- ~~`parseMemoryBytes` reused to parse pod count~~ — RESOLVED (v0.23.0, `handlers/nodes.go`: dedicated `parsePodCount()` using `strconv.ParseInt`).

- **Suggestion thresholds hardcoded** — `suggestions.ts`
  - 0.90, 0.70, 0.35, 3× not configurable. Fix: extract to config object.

- ~~Inconsistent errgroup initialisation~~ — RESOLVED (v0.23.0, `handlers/resources.go`: `var storageG errgroup.Group` → `errgroup.WithContext(r.Context())`, consistent with all other errgroups in handlers).

- ~~`KUBE_MIN_VERSION` exported but never used~~ — RESOLVED (v0.22.0, removed from `frontend/src/lib/version.ts`).

- ~~Inconsistent error handling patterns in frontend~~ — RESOLVED (v0.22.0, three silent catches in `dashboard/page.tsx` replaced with `console.warn`; fatal errors use `setError`; non-fatal background fetches use `console.warn`).

- ~~`SparklineModal.fmtVal()` duplicates `suggestions.ts:fmtSuggested()`~~ — RESOLVED (v0.23.0, shared `fmtRawValue()` in `lib/api.ts`; `SparklineModal.tsx` and `suggestions.ts` local formatters removed).

- ~~K8s types inlined in `k8s/client.go`~~ — RESOLVED (v0.23.0, extracted ~220 lines of K8s API response types to `k8s/types.go`).

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

### Resolved

- ~~`docker-publish.yml` image version empty / wrong tag~~ — RESOLVED (v0.20.0, `docker-publish.yml`: version derived from `$GITHUB_REF_NAME` shell env var when `GITHUB_REF_TYPE=tag`; falls back to `version.ts` for `workflow_dispatch`. Fixes empty-tag build failure caused by expression-syntax `${{ github.ref_name }}` resolving to empty string in some contexts).
- ~~`sbom-action` "Resource not accessible by integration"~~ — RESOLVED (v0.20.0, `docker-publish.yml`: job permissions changed from `contents: read` to `contents: write`, required for `anchore/sbom-action` to attach SBOM artifacts to GitHub Releases).
- ~~OIDC mode bypassed when in-cluster SA token present~~ — RESOLVED (v0.20.0, `page.tsx`: `oidcEnabled` now checked before `selectedClusterManaged`; SSO button always shown in OIDC mode regardless of managed flag).
- ~~"default" cluster invisible in cluster list~~ — RESOLVED (v0.20.0, `handlers/clusters.go`: "default" always included when `saTokens["default"]` exists and not already in `CLUSTERS` map; `middleware/cluster.go`: `X-Cluster: default` passes through to `KUBE_API_SERVER` when not in explicit cluster map; `middleware/session.go`: `SessionAuth` now falls back to `saTokens["default"]` like `ManagedAuth`).
- ~~Cluster switch caused full page reload~~ — RESOLVED (v0.20.0, `dashboard/page.tsx`: `window.location.reload()` replaced with in-place state updates; `cluster` added to effect dependency arrays so re-fetch triggers even when JWT token is unchanged).
- ~~Cluster switch required re-SSO in OIDC multi-cluster mode~~ — RESOLVED (v0.20.0, `handleClusterSwitch`: session JWT is cluster-agnostic — reused for new cluster without re-authentication).
- ~~Duplicate cluster colors in multi-cluster dropdown~~ — RESOLVED (v0.20.0, `lib/clusterColor.ts`: `buildClusterColors()` assigns colors by alphabetical rank; palette updated — lime removed, orange added).

- ~~OIDC provider discovery no timeout~~ — RESOLVED (`handlers/oidc.go`: `context.WithTimeout(10s)` on `gooidc.NewProvider()`).
- ~~No rate limiting on OIDC public endpoints~~ — RESOLVED (`main.go`: `Throttle(10)` group wrapping `/auth/loginurl` + `/api/auth/session`).
- ~~No audit logging for OIDC authentications~~ — RESOLVED (`handlers/oidc.go`: `log.Printf("OIDC session issued: subject=%q remote=%s", ...)` on every successful session creation).
- ~~Unknown cluster in SessionAuth logs nothing~~ — RESOLVED (`middleware/session.go`: `log.Printf` with the expected env var name to set).
- ~~SA token misconfiguration silent at startup~~ — RESOLVED (`main.go`: startup loop warns for each configured cluster with no matching SA token).
- ~~sessionStorage failure in /auth/done silently continues to /dashboard~~ — RESOLVED (`auth/done/page.tsx`: catch block now redirects to `/?error=auth_failed`).
- ~~Logout only clears kube-token* keys~~ — RESOLVED (`auth/logout/page.tsx`: also clears `kube-cluster` and all `kubeadjust:*` keys).
- ~~apiFetch 401 only clears kube-token (default cluster)~~ — RESOLVED (`lib/api.ts`: clears all `kube-token` and `kube-token:*` keys on 401).
- ~~No unit tests for OIDC session JWT~~ — RESOLVED (`oidc/session_test.go`: 7 test cases covering round-trip, expiry, tamper, malformed, GenerateState).
- ~~No unit tests for SessionAuth middleware~~ — RESOLVED (`middleware/session_test.go`: extractSessionToken + SessionAuth with 6 auth scenarios).
- ~~No unit tests for parseClusters / parseSATokens~~ — RESOLVED (`main_test.go`: 5 parseClusters + 6 parseSATokens cases including lowercase normalization and override priority).
- ~~No group-based access control in OIDC mode~~ — RESOLVED (`OIDC_GROUPS` env var + `oidc.groups` Helm value; `hasRequiredGroup()` in `handlers/oidc.go`; 7 test cases in `handlers/oidc_test.go`; distinct 403/`access_denied` flow in frontend).
- ~~Cluster switch requires re-entering token~~ — RESOLVED (v0.17.0, per-cluster token storage `kube-token:<cluster>`; seamless switch if already authenticated, login redirect otherwise).
- ~~Suggestion click on PVC/EmptyDir doesn't scroll~~ — RESOLVED (v0.17.0, volume suggestions scroll to `pod-row-${dep}-${pod}` instead of nonexistent container ID).
- ~~Ghost scroll on auto-refresh after failed scroll attempt~~ — RESOLVED (v0.17.0, scroll ref always cleared before attempt).
- ~~No favicon~~ — RESOLVED (v0.17.0, SVG hexagon icon in `frontend/src/app/icon.svg`).
- ~~No version indicator in the UI~~ — RESOLVED (v0.17.0, `v0.17.0` in topbar brand; `k8s ≥1.21` label removed).
- ~~Node pod list shows all pods paginated~~ — RESOLVED (v0.17.0, top 10 by usage with CPU/MEM sort toggle, no pagination).
- ~~Node grid unresponsive (always single column)~~ — RESOLVED (v0.17.0, `repeat(auto-fill, minmax(560px, 1fr))` — 2 columns on wide viewports, 1 below 680px).
- ~~Time range selector not shown on initial nodes view~~ — RESOLVED (v0.17.0, `/nodes` response now includes `prometheusAvailable`; range selector visible immediately).
- ~~Sparkline modal too wide with long pod names~~ — RESOLVED (v0.17.0, `max-width: min(540px, 95vw)` on modal; pod name shortened in title).
- ~~Node conditions (DiskPressure, MemoryPressure, PIDPressure) not visible~~ — RESOLVED (v0.16.0, red badges in node card header when active).
- ~~No node age/version info~~ — RESOLVED (v0.16.0, compact info line: age, kernel, OS image; kubelet version removed in v0.17.0).
- ~~No limit overcommit indicator on nodes~~ — RESOLVED (v0.16.0, `lim X%` + `OVERCOMMIT` badge in CircleGauge when sum(limits) > allocatable).
- ~~No namespace limit/request ratio~~ — RESOLVED (v0.16.0, `GET /api/namespaces/stats`, `CPU ×N.N MEM ×N.N` in mainHeader).
- ~~Node pod bars auto-loaded on mount~~ — RESOLVED (v0.16.0, lazy fetch on first expand, 10 pods/page with pagination).
- ~~ResourceBar track invisible (same color as card)~~ — RESOLVED (v0.16.0, `--bg` + border on all track elements).
- ~~Suggestion scroll race condition~~ — RESOLVED (v0.16.0, `preventDefault` + post-render `useEffect` scroll).
- ~~Suggestion scroll consumed on unrelated renders~~ — RESOLVED (v0.19.0, `useEffect` dependency array changed from none to `[openCards, workloadSearch]`; prevents auto-refresh and other state updates from consuming `scrollTargetRef` before the target element is in the DOM).
- ~~Pod filter button (`⊕`) unreliable~~ — RESOLVED (v0.17.0, nested-button HTML bug: pod header converted from `<button>` to `<div>`, toggle and filter are now sibling elements).
- ~~Suggestion panel groups fragmented by resource sub-type~~ — RESOLVED (v0.17.0, groups by severity: critical / warning / over-prov; resource shown as badge per item).
- ~~Suggestion panel gear icon / dual kind-filter mechanisms~~ — RESOLVED (v0.17.0, `excludedKinds` + sessionStorage dropdown removed; chips are now the single filter).
- ~~Node card header dense / non-responsive~~ — RESOLVED (v0.17.0, two-row header: identity + metadata; pressures + taints in dedicated alert row).
- ~~`kubeletVersion` in API response unused~~ — RESOLVED (v0.17.0, removed from `NodeOverview` in backend and frontend).
- ~~Pod filter button propagation~~ — RESOLVED (v0.16.0, partial — replaced `<span>` with `<button type="button">`; fully fixed in v0.17.0).
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
- `CLAUDE.md` — Known Issues: mark every item resolved this version as `~~...~~ — RESOLVED (vX.Y.Z, one-line summary)`
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
