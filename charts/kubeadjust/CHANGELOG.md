# Changelog

All notable changes to the KubeAdjust Helm chart are documented here.

---

## [0.26.0] - 2026-04-24

### Changed
- Update appVersion to 0.25.0

---

## [0.25.0] - 2026-04-10

### Changed
- Update appVersion to 0.24.0

---

## [0.24.0] - 2026-04-01

### Changed
- Update appVersion to 0.23.0

---

## [0.23.0] - 2026-03-22

### Changed
- Update appVersion to 0.22.0

---

## [0.22.0] - 2026-03-16

### Changed
- Update appVersion to 0.21.0

---

## [0.21.0] - 2026-03-12

### Changed
- Update appVersion to 0.20.0

---

## [0.20.0] - 2026-03-12

### Changed
- **`existingTokenSecret` now auto-mounts SA tokens from `backend.clusters`** — when set, no need to duplicate cluster names in `saTokens`; env vars `SA_TOKEN_<CLUSTER>` are derived automatically from `backend.clusters` keys
- Fix misleading `saTokens` comment: keys are always required when not using `existingTokenSecret`

---

## [0.19.2] - 2026-03-12

### Fixed
- Move chart to `charts/kubeadjust/` — fixes `helm dependency update` failing with "Chart.yaml file is missing" caused by `.helmignore` conflict at repo root
- Update CI to use `charts/kubeadjust` path for all helm commands (`dependency update`, `lint`, `template`)

### Changed
- Add CI lint badge and Helm 3.x/4.x compatibility badge to README
- Update README and CLAUDE.md to reflect chart path (`charts/kubeadjust`)

---

## [0.19.0] - 2026-03-11

### Added
- Initial release of the chart as a standalone repository (extracted from [kubeadjust](https://github.com/Thomas6013/kubeadjust))
- Full Helm chart for KubeAdjust v0.19.0 — backend + frontend deployments, RBAC, ServiceAccount, Ingress, NetworkPolicy, OIDC secrets
- `deploy/` directory with example Secret manifests (`oidc-secret.yaml`, `oidc-tokens-secret.yaml`, `viewer-serviceaccount.yaml`)
- GitHub Actions lint workflow — `helm lint --strict` + 5 template smoke tests
- `CONTRIBUTING.md`, `SECURITY.md`, `ROADMAP.md`, `CHANGELOG.md`
- Issue templates (bug report, feature request)

### Chart features (carried over from kubeadjust repo)
- Multi-cluster support via `backend.clusters` map
- OIDC/SSO authentication (`oidc.*` values) with group-based access control
- Optional metrics-server sub-chart (`metrics-server.enabled`)
- Optional Prometheus integration (`prometheus.enabled`)
- Optional NetworkPolicy (`networkPolicy.enabled`)
- Read-only ClusterRole (get/list/watch only — no write permissions ever)
- Hardened pod security contexts (`readOnlyRootFilesystem`, `runAsNonRoot`, `allowPrivilegeEscalation: false`)
