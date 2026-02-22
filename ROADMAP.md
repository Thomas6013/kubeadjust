# Roadmap

This is a living checklist of potential next steps for KubeAdjust, roughly ordered by priority.
Items are not committed to any timeline — this is a solo side project.

## Infrastructure & Distribution

- [ ] **Separate the Helm chart into its own repository** — publish to Artifact Hub independently from the source code, following the pattern of most CNCF projects (`kubeadjust-helm` repo with its own release cycle)
- [ ] **Publish to Artifact Hub** — add `artifacthub.io/repository` annotation and submit the Helm repo for indexing
- [ ] **GitHub Container Registry visibility** — ensure GHCR images are public once the repo goes public
- [ ] **Multi-arch Docker builds** — add `linux/arm64` target to `docker-publish.yml` for ARM clusters (Raspberry Pi, Ampere)
- [ ] **Automated GitHub Releases** — workflow that creates a GitHub Release from CHANGELOG entries when a new tag is pushed

## Features

- [ ] **Namespace multi-select** — watch multiple namespaces at once instead of switching
- [ ] **Persistent filters** — remember selected namespace + collapsed state in `localStorage`
- [ ] **Export suggestions as CSV / JSON** — one-click download for capacity planning reports
- [ ] **VPA integration** — show VerticalPodAutoscaler recommendations alongside manual suggestions when VPA is installed
- [ ] **Resource history comparison** — compare current requests/limits against a previous snapshot
- [ ] **Alert thresholds configuration** — let users customize the Critical/Warning/Over-provisioned thresholds (currently hardcoded)
- [ ] **Dark mode** — CSS variable–based theming

## Code Quality

- [ ] **Backend unit tests** — cover resource parsing (nanocores, bytes) and suggestion logic
- [ ] **Frontend unit tests** — cover `lib/suggestions.ts` and formatting helpers in `lib/api.ts`
- [ ] **Dependabot** — enable for Go modules, npm, GitHub Actions, and Helm dependencies
- [ ] **Lint in CI** — add `golangci-lint` for backend and `eslint` for frontend to the `ci.yml` workflow

## Documentation

- [x] **Screenshot / GIF in README** — show the dashboard in action (mock mode is enough)
- [ ] **Architecture decision records (ADR)** — document "no client-go", "no charting library", "raw HTTP to k8s API"
- [ ] **Helm values reference** — auto-generate from `values.yaml` annotations (e.g. with `helm-docs`)
