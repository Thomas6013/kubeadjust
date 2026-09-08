# Roadmap

This is a living checklist of potential next steps for KubeAdjust, roughly ordered by priority.
Items are not committed to any timeline — this is a solo side project.

## Infrastructure & Distribution

- [x] **Separate the Helm chart into its own repository** — chart moved to `kubeadjust-helm` _(v0.19.0)_
- [x] **Fold the chart back into this repository** — the split cost two PRs, two tags and two
  changelogs per release while both versions were bumped together anyway. Chart now at
  `charts/kubeadjust/`, one version number for the whole project _(v0.27.0)_
- [ ] **Publish a real Helm repository** — the only supported install is `git clone` +
  `helm install charts/kubeadjust`. The `helm repo add https://thomas6013.github.io/...`
  command the docs advertised until 0.27.0 never worked: neither the gh-pages branch nor a
  release workflow was ever created. Doing it for real means enabling Pages on this repo and
  adding [chart-releaser-action](https://github.com/helm/chart-releaser-action), which
  packages and indexes `charts/*` on every `Chart.yaml` version bump
- [ ] **Or publish the chart as an OCI artifact** — `helm push` to `ghcr.io` next to the
  images, installable as `oci://ghcr.io/thomas6013/kubeadjust/kubeadjust`. No Pages to
  enable, but a private registry means `helm registry login` before install
- [ ] **Publish to Artifact Hub** — needs a published Helm repository first, then an
  `artifacthub.io/*` annotation set in `Chart.yaml` and the repo submitted for indexing
- [ ] **chart-testing (`ct lint`)** — stricter chart validation than `helm lint --strict`:
  values schema checking and best-practice enforcement
- [ ] **Chart icon** — `helm lint --strict` reports `icon is recommended`; needs a hosted logo URL
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
- [x] **Frontend unit tests** — `lib/suggestions.test.ts`, 60 cases over 10 groups (vitest) _(v0.14.0)_
- [ ] **Backend handler tests** — `handlers/` and `k8s/client.go` retry logic are untested;
  needs a mock HTTP server
- [ ] **Frontend component tests** — no component is tested; needs
  `@testing-library/react`
- [x] **Renovate** — configured for Go modules, npm, GitHub Actions, and Helm dependencies _(v0.8.0)_
- [x] **Lint in CI** — `golangci-lint` for backend, `eslint` for frontend _(v0.7.0)_

## Documentation

- [x] **Screenshot in README** — dashboard screenshot _(v0.3.0)_
- [ ] **Architecture decision records (ADR)** — document "no client-go", "no charting library", "raw HTTP to k8s API"
- [x] **Helm values reference** — every value documented in `charts/kubeadjust/README.md` _(v0.27.0)_
- [ ] **Auto-generate the values reference** — keep it from drifting again with
  [helm-docs](https://github.com/norwoodj/helm-docs) reading `values.yaml` comments
- [x] **OIDC setup guide** — `docs/oidc.md` with Keycloak config, Helm commands, multi-cluster SA tokens _(v0.18.0)_

## Non-goals

- The ClusterRole will never gain a write permission. The dashboard reads; you apply changes
  yourself.
- No bundled ingress controller and no cert-manager — bring your own.
- No background GPS-style polling agent or server-side persistence of cluster history; the
  backend stays stateless (see `docs/PRODUCT.md` for where that trade-off is revisited).
