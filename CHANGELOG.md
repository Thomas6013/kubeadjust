# Changelog

All notable changes to KubeAdjust are documented here.

## [0.9.0] - 2026-02-27

### Added
- **Namespace search bar**: filter namespaces in the sidebar with a search input
- **Individual namespace restore**: hidden namespaces can now be restored one by one via a collapsible "hidden" section (replaces the old "Show all" button)
- **Empty namespace filtering**: namespaces with no running pods are automatically hidden from the sidebar (checked server-side in parallel)

### Fixed
- **Prometheus URL without scheme**: `PROMETHEUS_URL` values like `prometheus.monitoring:9090` (without `http://`) now work — the backend auto-prepends `http://` if missing

---

## [0.8.2] - 2026-02-27

### Fixed
- **Runtime backend proxy**: replaced Next.js build-time rewrite with an API route catch-all proxy (`/api/[...path]/route.ts`) that reads `BACKEND_URL` at runtime — fixes proxy failures when the Helm release name differs from the default
- **Backend URL uses FQDN**: frontend `BACKEND_URL` now includes the release namespace (`<name>-backend.<namespace>:<port>`) for reliable DNS resolution

### Changed
- **Dockerfile cleaned up**: removed build-time `BACKEND_URL` ARG from frontend Dockerfile — no longer needed since proxy is resolved at runtime

---

## [0.8.1] - 2026-02-27

### Added
- **Multi-architecture Docker images**: builds now produce `linux/amd64` and `linux/arm64` manifests, enabling deployment on ARM-based clusters (Raspberry Pi, AWS Graviton, Apple Silicon, etc.)
- **QEMU emulation** in CI for cross-platform builds (`docker/setup-qemu-action`)
- **Native Go cross-compilation**: backend Dockerfile uses `--platform=$BUILDPLATFORM` with `TARGETOS`/`TARGETARCH` for fast ARM builds without emulation

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
