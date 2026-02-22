# Changelog

All notable changes to KubeAdjust are documented here.

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
