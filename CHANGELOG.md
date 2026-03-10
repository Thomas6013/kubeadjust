# Changelog

All notable changes to KubeAdjust are documented here.

---

## [0.18.0] - 2026-03-08

### Added
- **OIDC authentication** — optional SSO login via any OIDC provider (Keycloak, Dex, Google, etc.). Set `OIDC_ENABLED=true` along with `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URL`, `SESSION_SECRET`, and `SA_TOKEN`/`SA_TOKENS`. When enabled, the login page shows a "Sign in with SSO" button instead of the token form. Fully backward-compatible: leaving `OIDC_ENABLED` unset preserves the existing token-based flow.
- **`GET /api/auth/config`** — public endpoint returning `{"oidcEnabled": bool}`. Used by the frontend login page to decide which authentication UI to show.
- **`GET /api/auth/loginurl`** — public endpoint (called server-side by Next.js) that generates a fresh OIDC authorization URL with a cryptographically random state.
- **`POST /api/auth/session`** — public endpoint (called server-side by Next.js) that exchanges an OIDC authorization code for a signed session JWT. Uses `coreos/go-oidc/v3` for JWKS-based ID token verification.
- **`middleware/session.go`** — `SessionAuth` middleware validates the session JWT and substitutes the pre-configured Service Account token into the request context. All downstream resource handlers are unchanged.
- **`oidc/session.go`** — minimal HS256 session JWT implementation using Go stdlib only (`crypto/hmac`, `crypto/sha256`). No external JWT library.
- **`/auth/login`, `/auth/callback`, `/auth/done`, `/auth/logout`** — Next.js server/client routes implementing the OIDC Authorization Code flow. CSRF protection via httpOnly `oidc-state` cookie (5 min TTL). Session token passed to the client via a short-lived readable cookie (30s, `Path=/auth/done`), then moved to `sessionStorage`.
- **Helm `oidc.*` values** — `oidc.enabled`, `oidc.issuerUrl`, `oidc.clientId`, `oidc.clientSecret`, `oidc.redirectUrl`, `oidc.sessionSecret`, `oidc.saToken`, `oidc.saTokens`. Secrets stored in a dedicated `kubeadjust-oidc` K8s Secret.
- **`docs/oidc.md`** — OIDC setup guide covering Keycloak configuration, Helm values, and multi-cluster SA token configuration.
- **Group-based access control** (`OIDC_GROUPS`) — optional comma-separated list of OIDC group names. The user must belong to at least one group to be granted a session JWT. When unset, any authenticated user can access (startup warning logged). The backend returns HTTP 403 on group mismatch; the frontend shows a distinct "Access denied" message. Group names are case-sensitive and matched exactly against the `groups` claim in the ID token. `docs/oidc.md` includes configuration guides for Keycloak, Dex, Azure AD, Okta, and Google Workspace.

### Fixed
- **OIDC provider discovery timeout** — `NewOIDCHandler` now passes a 10-second context to `gooidc.NewProvider()`. Previously the discovery fetch had no timeout and could hang indefinitely on a misconfigured or unreachable provider.
- **Group check returns generic `auth_failed` instead of distinct error** — `/auth/callback` now maps HTTP 403 from the backend to `/?error=access_denied`; the login page shows "Access denied. Your account is not authorised to use this dashboard." instead of the generic authentication failure message.
- **No rate limiting on OIDC public endpoints** — `/api/auth/loginurl` and `/api/auth/session` are now wrapped in a `Throttle(10)` group. These endpoints were the only API routes without concurrent request limiting.
- **Startup cluster/token mismatch not logged** — at startup, the backend now logs a `WARN` for every cluster in `CLUSTERS` that has no matching SA token, making misconfiguration visible immediately instead of surfacing as a runtime 400.
- **Unknown cluster in SessionAuth logged** — when `SessionAuth` receives a valid session JWT but an unknown `X-Cluster`, it now logs the expected env var name (`SA_TOKEN_<CLUSTER>`) to aid debugging.
- **sessionStorage failure in `/auth/done` silently redirected to dashboard** — if `sessionStorage.setItem()` throws (private browsing, storage full), the page now redirects to `/?error=auth_failed` instead of proceeding to `/dashboard` where every API call would fail with 401.
- **Logout only cleared `kube-token*` keys** — `/auth/logout` now also removes `kube-cluster` and all `kubeadjust:*` keys (view, namespace, time range, open cards) from `sessionStorage`, preventing stale state from leaking into a subsequent session.
- **401 handler only cleared default cluster token** — `apiFetch` now clears all `kube-token` and `kube-token:*` keys on a 401 response, not just the default-cluster key.

### Tests
- **`oidc/session_test.go`** — 7 cases: valid round-trip (subject preserved), expired token, wrong secret, tampered payload, tampered header, malformed tokens, empty subject, GenerateState uniqueness.
- **`middleware/session_test.go`** — `extractSessionToken` (header, cookie, precedence, empty, whitespace-only Bearer) + `SessionAuth` (no token, invalid, expired, valid default cluster, valid named cluster, unknown cluster, JSON Content-Type on 401).
- **`handlers/oidc_test.go`** — `AuthConfig` with `oidcEnabled=true/false` (status, Content-Type, body).
- **`main_test.go`** — `parseClusters` (empty, single, multi, whitespace, malformed skip) + `parseSATokens` (SA_TOKEN, SA_TOKENS, SA_TOKEN_* lowercase, underscore→hyphen, override priority between sources).

---

## [0.17.0] - 2026-03-06

### Added
- **Top pods view in node cards** — the pod list in the node card now shows the top 10 pods sorted by resource use, with a CPU/MEM sort toggle. Replaces the previous paginated full list. More actionable at a glance for spotting heavy consumers on a node.
- **Time range selector visible on nodes view** — the `/nodes` endpoint now returns `prometheusAvailable`. The 1h / 6h / 24h / 7d range selector appears in the topbar from the first page load regardless of which view (nodes or workloads) is visited first.

### Changed
- **Suggestion panel filtered by workload search** — the `⊕` pod-level filter button on pod rows has been removed. The suggestion panel now reacts to the workload search bar: typing a deployment name or pod name filters both the deployment list and the suggestion panel simultaneously. Simplifies the UX to a single filter mechanism.

- **Node card header restructured** — the node card now uses two distinct rows: identity (icon + name + status + roles) and metadata (age · OS image · kernel). The pod count badge (`running / max`) moves to the right end of the identity row. Pressure badges and taint labels are consolidated into a single alert row, hidden when the node is healthy.
- **Node grid: 2 columns on wide screens, 1 on narrow** — the node grid uses `grid-template-columns: repeat(auto-fill, minmax(560px, 1fr))`, giving 2 side-by-side cards on wide viewports and a single column below 680px.
- **Topbar version simplified** — the `k8s ≥1.21` minimum version indicator is removed from the topbar. Only the app version (`v0.17.0`) is shown.
- **`kubeletVersion` removed from backend and frontend** — field removed from `NodeOverview` in `backend/resources/types.go`, handler, and TypeScript interface. Was returned by the API but never rendered.
- **Suggestion panel: groups by severity, filter by resource** — the suggestion list is now grouped by severity (▲ critical / ● warning / ▼ over-prov) instead of resource type. All critical items appear first regardless of resource. Each item shows a `resourceTag` badge. Within each group, items are sorted by resource type.
- **Suggestion filter chips: resource category (CPU / Memory / Storage)** — chips filter by resource category instead of severity. CPU covers all CPU sub-types, Memory covers all memory sub-types, Storage covers Ephemeral, PVC, and EmptyDir.
- **Suggestion panel: gear icon and persistent kind-exclusion removed** — the ⚙ dropdown was redundant with the chip filter. Chips are now the single filtering mechanism.
- **Favicon updated** — the SVG icon is now a Kubernetes-style hexagon with a helm wheel in Kubernetes blue (`#326CE5`).
- **Per-cluster token storage** — tokens are now stored per cluster (`kube-token:<cluster>`) in sessionStorage. Switching to a cluster already visited in the current session is seamless (no re-authentication). Backwards-compatible with single-cluster sessions.

### Fixed
- **Pod filter button (`⊕`) unreliable** — was nested inside a `<button>` (invalid HTML). Browsers flatten nested interactive elements, making `stopPropagation()` unreliable. Pod header converted from `<button>` to `<div>` with a `.toggleBtn` inside; filter button is now a sibling.
- **Stale duplicate test files in handlers/** — `handlers/prometheus_test.go` and `handlers/resources_test.go` referenced unexported functions (`isValidLabelValue`, `parseCPUMillicores`, `parseMemoryBytes`) that were moved to the `resources/` package in v0.13.0. Files removed; coverage provided by `resources/validate_test.go` and `resources/parse_test.go`.
- **Conflicting `middleware.ts` / `proxy.ts`** — Next.js 16 renamed the middleware entrypoint to `proxy.ts`; the old `src/middleware.ts` was still present, causing a build error. Removed `middleware.ts`.
- **Suggestion click on PVC/EmptyDir doesn't scroll** — these suggestions used the volume name as the container identifier, generating a scroll target that never existed in the DOM. Now correctly scrolls to the pod row for volume-type suggestions.
- **`TimeRange` type not imported in dashboard page** — TypeScript build error (`Cannot find name 'TimeRange'`) caused by a missing import in `dashboard/page.tsx`. Type was already exported from `@/lib/api` but not imported.
- **Ghost scroll on subsequent renders** — the scroll ref was only cleared when the target element was found. Ref is now always cleared immediately before the attempt.
- **Sparkline modal too wide with long pod names** — the modal now has a fixed `max-width: min(540px, 95vw)`. Pod names in the modal title are shortened (last two random suffixes stripped, matching the pod bar display).

---

## [0.16.0] - 2026-03-04

### Added
- **Node conditions badges** — DiskPressure, MemoryPressure, and PIDPressure conditions are now shown as red badges directly in the node card header when active. Actionable at a glance without drilling into kubectl.
- **Node info line** — each node card now displays age, kubelet version, kernel version, and OS image in a compact monospace line below the header. Useful for spotting heterogeneous nodes in a cluster.
- **Limit overcommit indicator in node gauges** — the CircleGauge on each node now shows `lim X%` below the request line. When the sum of all pod limits exceeds the node's allocatable capacity, an `OVERCOMMIT` badge appears in red — indicating the node is unstable under simultaneous resource peaks.
- **Namespace limit/request ratio** — a new `GET /api/namespaces/stats` endpoint aggregates CPU and memory limit/request ratios per namespace. The dashboard displays `CPU ×N.N MEM ×N.N` above the workload search bar for the selected namespace, color-coded by severity (>5× red, >2× orange, neutral otherwise).
- **Docker PR preview builds** — new `.github/workflows/docker-pr.yml` workflow: on every pull request to `main`, builds an amd64 image tagged `pr-<number>` and `pr-<number>-<sha>`, then posts (and updates) a comment on the PR with ready-to-use `values.yaml` snippets for both backend and frontend.

### Changed
- **Node pod bars: lazy fetch + pagination** — pods in the node view are no longer auto-loaded on mount. They are fetched only when the user clicks "Pods (N) ▶". Up to 10 pods are shown per page with Prev/Next pagination. Reduces API load for large clusters.
- **Removed "Container details" toggle from node view** — the per-pod `PodRow` breakdown (container-level bars) has been removed from the node card. The horizontal pod bar diagram (request vs usage) remains as the primary view.
- **Pod bar tooltips instead of legend** — the "■ req / ■ use" legend row under pod bars has been removed. Tooltips on each bar track now show the exact values and percentages (e.g. `req: 250m (12%) · use: 180m (9%)`).

### Fixed
- **ResourceBar track invisible** — the track background used `--surface2`, the same color as the card background, making the bar invisible. Fixed to use `--bg` with a `1px solid var(--border)` border. Same fix applied to pod bar tracks and ephemeral storage tracks in PodRow.
- **Suggestion scroll race condition** — clicking a suggestion item could fail to scroll to the container if the deployment card or pod row was previously closed (the DOM element didn't exist yet when the scroll fired). Fixed with: `e.preventDefault()` on the anchor click, passing the container ID through `handleOpenCards`, and a post-render `useEffect` that scrolls once the target element appears in the DOM.
- **Suggestion click clears workload search filter** — if a workload search was active and filtered out the target deployment, clicking a suggestion silently did nothing. Now clears `workloadSearch` when the target deployment is not in the filtered list.
- **Pod filter button propagation** — the `⊕` filter button on pod rows was a `<span>` inside a `<button>`, causing unreliable `stopPropagation`. Replaced with `<button type="button">` with both `preventDefault` and `stopPropagation`.
- **Pod filter not switching** — clicking `⊕` on a different pod while a filter was active didn't switch the filter to the new pod. Now correctly replaces the active filter instead of toggling it off.
- **Node count badge alignment in sidebar** — the Nodes button count badge was misaligned after a flex layout change. Fixed by restoring `flex-direction: row` on the node button.

---

## [0.15.0] - 2026-03-03

### Added
- **Cluster card selector on login page** — replaces the native `<select>` dropdown with a styled button grid; each configured cluster is shown as a card with visual selection feedback. Works even when only one cluster is configured.
- **Cluster switcher in dashboard topbar** — when more than one cluster is configured, the cluster badge becomes a clickable button with a dropdown to switch clusters without going back to the login page. Switching reloads the dashboard cleanly.
- **Workload/pod search in namespace view** — a search input above the deployment list filters workloads by deployment name or pod name in real time.
- **"Request too low" suggestion** — new `warning`/`danger` suggestion in `SuggestionPanel` when P95 usage exceeds the request by more than 10% (danger when ≥ 2×). Helps catch pods that are regularly bursting above their guaranteed resources and risk throttling or eviction. Only fires when not already flagged as overkill.
- **Taint labels on node cards** — node taints (key, optional value, effect) are displayed as small badges under the node name. Color-coded by effect: `NoSchedule`/`NoExecute` in red, `PreferNoSchedule` in orange.
- **Pod resource bar diagram on node view** — each node card now auto-loads its pods and displays a compact horizontal bar per pod, showing CPU and memory request (transparent fill) vs. live usage (solid fill) as a percentage of node allocatable. No click required; up to 25 pods shown. A "Container details" toggle reveals the full `PodRow` breakdown.
- **Sparkline zoom modal** — clicking any Prometheus sparkline (CPU or memory history) opens a modal with a larger chart, time labels on the x-axis, and min/max/current statistics. Close with `Esc` or click outside.
- **Pod filter in suggestion panel** — each pod row now has a `⊕` button that filters the suggestion panel to show only that pod's suggestions. A filter indicator bar appears at the top of the panel with a clear button. Clicking a suggestion item now opens both the deployment card and the pod row before scrolling to the container.

### Fixed
- **SuggestionGroup open/close state reset** — open/close state of suggestion groups was local to each `SuggestionGroup` component and silently reset on namespace switch, auto-refresh, or chip filter change. State is now lifted to `SuggestionPanel` as a `Map<string, boolean>`, preserving each group's state across re-renders.
- **Suggestion click does not open deployment card** — clicking a suggestion item now programmatically opens the target `DeploymentCard` and `PodRow` (adds both to `openCards`) before scrolling to the container block.

---


## [0.14.0] - 2026-03-02

### Added
- **Node pod drill-down** — click "Pods (n)" on any node card to lazy-load the list of running pods on that node, each with per-container CPU/memory requests, limits, and live usage. Uses `GET /api/nodes/{node}/pods`; pods include their namespace for cross-namespace nodes.
- **Multi-cluster support** — set `CLUSTERS=prod=https://...,staging=https://...` on the backend; a cluster selector appears on the login page when more than one cluster is configured. The selected cluster is persisted in `sessionStorage` and shown as a badge in the dashboard topbar.
- **`GET /api/clusters`** — new public endpoint (no auth required) returning the list of configured cluster names.
- **Auto-refresh** — configurable interval (30 s / 60 s / 5 min) in the topbar. Silently updates data without clearing the current view; pauses automatically when the browser tab is hidden (Page Visibility API). Persisted in `sessionStorage`.
- **ServiceAccount YAML for remote clusters** — `deploy/viewer-serviceaccount.yaml`: a standalone manifest to apply on any cluster, creating a `kubeadjust-viewer` SA + read-only ClusterRole + ClusterRoleBinding with usage instructions.
- **Helm `networkPolicy.enabled`** — optional NetworkPolicy restricting traffic to frontend↔backend:8080 and backend→K8s API (443/6443).
- **Helm `backend.allowedOrigins`** — dedicated values key for CORS origins, injected as `ALLOWED_ORIGINS` env var in the backend deployment.
- **Helm `backend.clusters`** — dedicated values key for multi-cluster configuration, injected as `CLUSTERS` env var.

### Changed
- **CSP is now nonce-based** (`src/proxy.ts`, Next.js 16) — removes `'unsafe-inline'` and `'unsafe-eval'` from `script-src`. Uses `'strict-dynamic'` so trusted scripts can load sub-resources without listing them individually.
- **Container cards in pod view** — each container block now has a distinct card appearance (background, border, rounded corners, uppercase header separator) for clearer visual separation.
- **`middleware.ts` renamed to `proxy.ts`** — following Next.js 16 file convention rename (`middleware` → `proxy`).

### Fixed
- **CORS whitespace** — `ALLOWED_ORIGINS="https://a.com, https://b.com"` now trims spaces before splitting; a space in the env var no longer breaks CORS matches.
- **Frontend proxy path traversal** — the Next.js API proxy now rejects paths containing `..`, `//`, or null bytes with 400 Bad Request.
- **Frontend `readOnlyRootFilesystem`** — added `readOnlyRootFilesystem: true` to Helm frontend deployment along with an `emptyDir` volume at `/tmp` for Next.js write access.
- **`X-Cluster` header** — added to the CORS `AllowedHeaders` list so browsers do not block preflight requests.

---

## [0.13.0] - 2026-02-28

> **Note:** versions 0.9.0 through 0.12.1 were consolidated into this release. The version jump from 0.8.0 to 0.13.0 is intentional — previous minor versions were used during development and their tags remain immutable on GitHub.

### Added
- **Multi-architecture Docker images**: `linux/amd64` and `linux/arm64` manifests via QEMU + native Go cross-compilation
- **Runtime backend proxy**: API route catch-all proxy (`/api/[...path]/route.ts`) reads `BACKEND_URL` at runtime — no more build-time baking
- **Namespace search bar**: filter namespaces in the sidebar with a search input
- **Individual namespace restore**: hidden namespaces can be restored one by one via a collapsible "hidden" section
- **Empty namespace filtering**: namespaces with no running pods are automatically hidden (checked server-side in parallel)
- **Time range selector**: 1h / 6h / 24h / 7d toggle controlling Prometheus query range for sparklines and suggestions, with adaptive step sizes (60s → 900s)
- **Prometheus-weighted suggestions**: suggestions use **P95** for danger/warning thresholds and **mean** for overkill detection when Prometheus is available; falls back to metrics-server snapshot
- **Over-provisioned limit detection**: overkill suggestion when a limit exceeds 3× P95 usage
- **Namespace history endpoint**: `GET /api/namespaces/{ns}/prometheus?range=X` returns CPU/memory history for all containers in a single request (parallelized with errgroup)
- **Eager Prometheus fetch**: dashboard fetches namespace-wide history automatically when Prometheus is available
- **Persistent dashboard state**: view, namespace, time range, opened cards/pods preserved across page refreshes (via sessionStorage)
- **No-limit warning**: containers without a CPU or Memory limit generate a suggestion with a recommended limit based on P95 usage (or 2× current if no Prometheus)
- **No-request warning**: containers without a CPU or Memory request generate a warning — the scheduler cannot guarantee resources without requests
- **Confidence indicator**: suggestions display confidence level (low / medium / high) based on Prometheus data availability
- **Rate limiting**: API routes throttled to 20 concurrent requests via Chi Throttle middleware
- **Frontend readinessProbe**: Helm deployment includes a readiness probe, preventing 503 errors during rolling updates

### Fixed
- **Proxy drops query parameters**: time range selector (`?range=6h`) was silently dropped by the frontend API proxy — now appends `req.nextUrl.search`
- **PodRow infinite fetch loop**: failed Prometheus fetches caused infinite re-render loop — replaced with ref-based tracking
- **Double Prometheus fetch**: namespace history fetched both eagerly and via useEffect — removed duplicate
- **ResourceBar headroom at 100% usage**: headroom showed raw limit string instead of "0m" / "0"
- **Auth middleware Content-Type**: returned `text/plain` instead of `application/json`; added empty-token check
- **PromQL injection hardened**: replaced weak blacklist with strict whitelist (`[a-zA-Z0-9._-]`)
- **LimitReader silent truncation**: 10MB truncation produced misleading JSON parse errors — now returns explicit error
- **Namespace list non-deterministic order**: goroutine scheduling caused random ordering — now sorted alphabetically
- **Stale suggestions on namespace switch**: deployments from previous namespace briefly shown during loading — now cleared immediately
- **View resets on refresh**: persistence race condition fixed with `restored` flag
- **Suggestion action labels**: each suggestion now has its own action label (was incorrectly reusing "Reduce request" for all)
- **401 auto-logout**: expired tokens now auto-clear sessionStorage and redirect to login
- **Time range selector hidden**: no longer displayed when Prometheus is unavailable
- **Suggestion filter dropdown**: improved readability with accent colors and distinct background
- **Prometheus URL without scheme**: auto-prepends `http://` if missing
- **Backend URL uses FQDN**: includes release namespace for reliable DNS resolution

### Changed
- **Backend Dockerfile**: replaced `go mod tidy` with `go mod download` for better reproducibility
- **Global Prometheus client**: created once at startup, injected into handlers (was per-request)
- **Sparklines enlarged**: 72×20 → 120×32 for better readability
- **Prometheus client timeout**: 10s → 30s for longer range queries
- **Rate window adapts to range**: `rate()` window scales from 5m (1h) to 15m (7d)

### Refactored
- **Backend package separation**: extracted resource calculation logic (parsing, formatting, aggregation, validation) into a dedicated `resources/` package — handlers now only orchestrate K8s API calls

---

## [0.8.0] - 2026-02-27

### Added
- **Clickable severity chips**: click critical/warning/over-prov chips to filter the suggestion list (multi-select, panel only)
- **Suggestion type exclusion**: settings dropdown in panel header to permanently hide suggestion categories (persisted in sessionStorage)
- **Namespace exclusion**: hide namespaces from sidebar via hover button, with "Show all (N hidden)" restore link (persisted in sessionStorage)
- **Default view set to Nodes**: dashboard opens on node overview instead of namespaces

### Fixed
- **Stable React keys** in SuggestionPanel (replaced array index with composite key)
- **golangci-lint errcheck** warnings resolved across all backend handlers
- **Removed dead code**: unused `isMetricsServerUnavailable` function

### CI
- Upgraded golangci-lint to v2.10 / action v7 (Go 1.26 support)
- Disabled `next lint` step (removed in Next.js 16)
- Added missing `go.sum` entry for `golang.org/x/sync/errgroup`

---

## [0.7.0] - 2026-02-26

### Security
- **CORS configurable**: `AllowedOrigins: ["*"]` replaced by `ALLOWED_ORIGINS` env var (comma-separated), with startup warning when unset
- **K8s errors no longer leaked**: all handlers now log errors server-side with `log.Printf` and return generic messages to clients
- **`io.LimitReader` (10 MB cap)**: applied to both `k8s/client.go` and `prometheus/client.go` to prevent OOM on large responses
- **CSP + security headers**: `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` added in `next.config.mjs`
- **`KUBE_INSECURE_TLS` startup warning**: logs `WARN: TLS verification disabled` when enabled

### Performance
- **Parallel K8s API calls**: `ListDeployments` now fetches deployments, statefulsets, cronjobs, replicasets, jobs, metrics and PVCs concurrently via `errgroup`
- **Parallel node summaries**: kubelet stats calls run concurrently with `errgroup.SetLimit(5)`
- **Shared HTTP transport**: single `http.Transport` reused across all K8s client instances (connection pooling)

### Added
- **Unit tests**: `parseCPUMillicores`, `parseMemoryBytes` (`resources_test.go`) and `isValidLabelValue` (`prometheus_test.go`)
- **golangci-lint** in CI backend job
- **`npm run lint`** in CI frontend job
- **`go test ./...`** in CI backend job
- **SBOM generation**: `anchore/sbom-action` in Docker publish workflow
- **Image signing**: `sigstore/cosign` keyless signing in Docker publish workflow
- **`.env.example`**: documents all env vars at repo root
- **`CODE_OF_CONDUCT.md`**: Contributor Covenant v2.1
- **Code of Conduct reference** added to `CONTRIBUTING.md`

### Docs
- `CLAUDE.md` fully rewritten for v0.7.0 (env var table, updated security model, new backlog)
- `improve.md` updated with v0.7.0 audit results (resolved items marked, new issues identified)

### Dependencies
- Added `golang.org/x/sync` (errgroup) to backend `go.mod`

---

## [0.6.0] - 2026-02-23

### Changed
- **Helm — independent replica counts**: `replicaCount` (top-level) replaced by `backend.replicaCount` and `frontend.replicaCount` — backend and frontend can now be scaled independently
- **Helm — values.yaml defaults cleaned up**: `KUBE_INSECURE_TLS` is no longer set to `true` in the default values (TLS verification is enabled by default); `pullSecrets` defaults to `[]`

### Fixed
- **`.gitignore`**: trailing space on the `build` entry caused the file/directory to be silently un-ignored on some systems

### Docs
- Removed stale `mock-dev-token` references from README and CONTRIBUTING (feature not implemented)
- SECURITY.md supported versions table updated to 0.6.x

---

## [0.5.0] - 2026-02-22

### Changed
- **Helm values consolidated**: merged the two-key pattern (`metricsServer.enabled` + `metrics-server.*`) into a single `metrics-server:` block — `enabled`, `args` and any future sub-chart values now all live under `metrics-server:` in `values.yaml`
- **Chart.yaml condition updated**: dependency condition changed from `metricsServer.enabled` to `metrics-server.enabled` to match the unified key
- **Git history reset**: squashed full commit history into a single clean initial commit for a cleaner repository baseline

---

## [0.4.2] - 2026-02-22

### Fixed
- **Docker Publish workflow**: removed `v` prefix from version tag — images are now tagged `0.4.2`, `latest` and commit SHA (not `v0.4.2`)

---

## [0.4.1] - 2026-02-22

### Fixed
- **Image path corrected**: GHCR image repositories updated to `ghcr.io/thomas6013/kubeadjust/kubeadjust-{backend,frontend}` — `docker-publish.yml` and `values.yaml` are now aligned on this path

---

## [0.4.0] - 2026-02-22

### Fixed
- **Helm sub-chart misconfiguration**: `metricsServer.args` was silently ignored because it was nested under the parent-chart key instead of the sub-chart key — moved to `metrics-server.args` in `values.yaml` so args (e.g. `--kubelet-insecure-tls`) are correctly forwarded to metrics-server
- **Helm alias removed**: `alias: metricsServer` on the metrics-server dependency generated invalid Kubernetes resource names (`kubeadjust-metricsServer`) — alias reverted, two-key pattern restored (`metricsServer.enabled` to toggle, `metrics-server.*` for sub-chart config)

---

## [0.3.1] - 2026-02-22

### Fixed
- **Docker Publish workflow**: GHCR image tags failed with `repository name must be lowercase` — `GITHUB_REPOSITORY_OWNER` is now lowercased via bash `${,,}` expansion before being used in image tags

---

## [0.3.0] - 2026-02-22

### Added
- **Docker Publish workflow**: images automatically built and pushed to GHCR on every merge to `main`, tagged `latest`, `vX.Y.Z` (from `Chart.appVersion`) and commit SHA
- **ROADMAP.md**: public checklist of potential next steps
- **Dashboard screenshot**: `docs/screenshot.png` displayed in README

### Changed
- **Helm image tags default to `Chart.appVersion`**: `backend.image.tag` and `frontend.image.tag` default to `""` in `values.yaml`; the deployment template falls back to `.Chart.AppVersion` — only `Chart.yaml` needs updating on a release
- **metrics-server sub-chart aliased to `metricsServer`**: Helm dependency now uses `alias: metricsServer` so all sub-chart values (including `replicas`) are configured under the same `metricsServer:` key instead of `metrics-server:`
- README updated with solo-project disclaimer and AI-assisted development notice
- CONTRIBUTING.md updated with versioning convention and release checklist

---

## [0.2.0] - 2026-02-22

### Added
- **Metrics-server detection**: warning banner displayed when metrics-server is not installed or unreachable
- **Prometheus sparklines**: optional inline SVG CPU/memory trend graphs (last 1h) per container, loaded from an existing Prometheus — pure SVG, no charting library
- **Optional Helm sub-chart**: metrics-server can be deployed as a Helm dependency (`metricsServer.enabled=true`)
- **Prometheus Helm values**: `prometheus.enabled` + `prometheus.url` to inject `PROMETHEUS_URL` into the backend
- New backend route `GET /api/namespaces/{ns}/prometheus/{pod}/{container}` for historical data

### Changed
- `/api/namespaces/{ns}/deployments` response now returns a `WorkloadResponse` envelope: `{ workloads, metricsAvailable, prometheusAvailable }` instead of a bare array
- Helm chart version bumped to `0.2.0`

---

## [0.1.0] - 2026-02-20

### Added
- **Workload dashboard**: Deployments, StatefulSets and CronJobs in one view
- **Resource bars**: CPU / Memory / Ephemeral Storage per container, with requests, limits and live usage
- **Color-coded status**: Critical (≥90% of limit), Warning (≥70%), Over-provisioned (≤35% of request), Healthy
- **PVC and emptyDir volumes**: capacity, usage, available per pod
- **Suggestions panel**: grouped by resource type (CPU, Memory, Ephemeral — no limit, Ephemeral, PVC, EmptyDir); collapsible groups; sorted by severity
- **Node overview**: capacity, allocatable, requested, limited, live usage per node
- **StatefulSet + CronJob support**: owner-reference-based pod matching (replaces fragile prefix matching)
- **Kind badge**: StatefulSet and CronJob workloads labelled in the UI
- **All cards collapsed** by default for a clean overview
- Mock mode: token `mock-dev-token` returns hardcoded demo data
- Helm chart with read-only ClusterRole + ClusterRoleBinding
- Multi-stage Docker builds (scratch image for backend)

### Fixed
- CPU metrics showing 0%: metrics-server returns nanocores (`18447n`) which were not parsed — now correctly converted to millicores
