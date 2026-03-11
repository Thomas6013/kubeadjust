# Roadmap

This is a living checklist of potential next steps for KubeAdjust, roughly ordered by priority.
Items are not committed to any timeline — this is a solo side project.

## Infrastructure & Distribution

- [ ] **Separate the Helm chart into its own repository** — publish to Artifact Hub independently from the source code
- [ ] **Publish to Artifact Hub** — add `artifacthub.io/repository` annotation and submit the Helm repo for indexing
- [ ] **GitHub Container Registry visibility** — ensure GHCR images are public once the repo goes public
- [x] **Multi-arch Docker builds** — `linux/amd64` + `linux/arm64` via QEMU + native Go cross-compilation _(v0.13.0)_
- [ ] **Automated GitHub Releases** — workflow that creates a GitHub Release from CHANGELOG entries when a new tag is pushed

## Features

- [ ] **Namespace multi-select** — watch multiple namespaces at once instead of switching
- [x] **Persistent filters** — view, namespace, time range, opened cards, excluded namespaces persisted in sessionStorage _(v0.13.0)_
- [x] **Multi-cluster support** — `CLUSTERS` env var, cluster selector on login, `X-Cluster` header routing _(v0.14.0)_
- [x] **Auto-refresh** — configurable interval (30 s / 60 s / 5 min), pauses on hidden tab, silent background update _(v0.14.0)_
- [x] **OIDC / SSO authentication** — optional SSO via Keycloak, Dex, Google, or any OIDC provider; works on managed clusters (EKS, GKE, AKS); SA token per cluster; backward-compatible with token mode _(v0.18.0)_
- [ ] **Export suggestions as CSV / JSON** — one-click download for capacity planning reports
- [ ] **VPA integration** — show VerticalPodAutoscaler recommendations alongside manual suggestions when VPA is installed
- [ ] **Resource history comparison** — compare current requests/limits against a previous snapshot
- [ ] **Alert thresholds configuration** — let users customize the Critical/Warning/Over-provisioned thresholds (currently hardcoded)
- [ ] **Dark mode** — CSS variable-based theming


## Code Quality

- [x] **Backend unit tests** — resource parsing (nanocores, bytes) and PromQL validation _(v0.7.0)_
- [ ] **Frontend unit tests** — cover `lib/suggestions.ts` and formatting helpers
- [x] **Renovate** — configured for Go modules, npm, GitHub Actions, and Helm dependencies _(v0.8.0)_
- [x] **Lint in CI** — `golangci-lint` for backend, `eslint` for frontend _(v0.7.0)_

## Documentation

- [x] **Screenshot in README** — dashboard screenshot _(v0.3.0)_
- [ ] **Architecture decision records (ADR)** — document "no client-go", "no charting library", "raw HTTP to k8s API"
- [ ] **Helm values reference** — auto-generate from `values.yaml` annotations (e.g. with `helm-docs`)
- [x] **OIDC setup guide** — `docs/oidc.md` with Keycloak config, Helm commands, multi-cluster SA tokens _(v0.18.0)_
