# Contributing to KubeAdjust

Thank you for taking the time to contribute!

## Getting started

1. Fork the repository and clone your fork
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes (see development setup below)
4. Open a pull request against `main`

## Development setup

### Prerequisites

- Go 1.27+
- Node.js 26+ (CI builds on 26)
- Helm 3.x or 4.x (chart changes only)
- Docker + Docker Compose (optional)
- A Kubernetes cluster (required for the backend)

### Run locally

```bash
# Backend
cd backend
KUBE_API_SERVER=https://<your-cluster> KUBE_INSECURE_TLS=true go run .

# Frontend (separate terminal)
cd frontend
npm install && npm run dev
```

Or with Docker Compose:

```bash
KUBE_API_SERVER=https://<your-cluster> docker compose up --build
```

## Project structure

```
backend/
  main.go               # chi router + routes
  k8s/client.go         # raw HTTP client to k8s API (no client-go)
  prometheus/client.go  # optional Prometheus client
  middleware/auth.go    # Bearer token extraction
  handlers/
    resources.go        # main workloads handler
    nodes.go
    auth.go
    prometheus.go       # history endpoint

frontend/src/
  lib/api.ts            # typed API client + formatting helpers
  lib/suggestions.ts    # suggestion computation logic
  components/           # ResourceBar, PodRow, DeploymentCard, SuggestionPanel, Sparkline...
  app/
    page.tsx            # login
    dashboard/page.tsx  # main dashboard

charts/kubeadjust/      # the Helm chart (version == app version)
  Chart.yaml            # version + appVersion, metrics-server dependency
  Chart.lock            # pins the sub-chart digest -- tracked
  values.yaml           # every value carries an inline comment
  README.md             # the values reference
  templates/            # deployments, rbac, service, ingress, networkpolicy, oidc secret

deploy/                 # example manifests applied by hand, not part of the chart
```

## Guidelines

- **Backend**: No client-go. All Kubernetes API calls go through `k8s/client.go` (raw HTTP). Keep the backend stateless — no caching, no database.
- **Frontend**: No UI library. CSS Modules only. No charting libraries — sparklines use pure SVG.
- **Suggestions**: Thresholds live in `frontend/src/lib/suggestions.ts`. Keep them configurable.
- **RBAC**: any new Kubernetes resource access must be added to
  `charts/kubeadjust/templates/rbac.yaml`, with a `get`/`list`/`watch` verb only. The
  ClusterRole never gains a write verb.
- **Chart values**: every value in `charts/kubeadjust/values.yaml` needs an inline comment
  saying what it does and any constraint (e.g. `# must be ≥32 chars`), and a row in
  `charts/kubeadjust/README.md`. A value no template reads is a bug, not a placeholder —
  `rbac.role` sat in `values.yaml` unread from 0.19.0 to 0.26.0.

## Project scope

The app and its Helm chart are one repository and one version line. Chart-only changes are
as welcome here as code changes — there is no separate chart repo to open them against.
(There was one, `kubeadjust-helm`, from 0.19.0 to 0.26.0. It is closed.)

| What | Where |
|---|---|
| Backend | `backend/` |
| Frontend | `frontend/` |
| Helm chart, RBAC, deployment templates | `charts/kubeadjust/` |
| Example Secret / SA manifests | `deploy/` |
| Security vulnerabilities | see [SECURITY.md](SECURITY.md) — do not open an issue |

## Versioning

One number for the whole project. When bumping a release, update **all four**:

1. `frontend/src/lib/version.ts` — `APP_VERSION` constant (displayed in the topbar)
2. `frontend/package.json` — `version` field
3. `charts/kubeadjust/Chart.yaml` — `version`
4. `charts/kubeadjust/Chart.yaml` — `appVersion` (same value as `version`)

Docker images are published via `docker-publish.yml` when a `*.*.*` git tag is pushed:
```bash
git tag 0.22.0 && git push origin 0.22.0
```

## Pull request checklist

- [ ] `go vet ./...` passes in `backend/`
- [ ] `go test ./...` passes in `backend/`
- [ ] `npm run build` passes in `frontend/`
- [ ] `npm run lint` passes in `frontend/`
- [ ] `helm lint charts/kubeadjust --strict` passes (chart changes only — run
      `helm dependency build charts/kubeadjust` first)
- [ ] `helm template kubeadjust charts/kubeadjust` renders (chart changes only)
- [ ] New chart values are commented in `values.yaml` **and** listed in
      `charts/kubeadjust/README.md`
- [ ] New env vars are documented in `README.md` and `CLAUDE.md`
- [ ] All four version fields bumped together (if releasing — see Versioning above)
- [ ] `CHANGELOG.md` updated (if releasing)

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).
Please read it before participating.

## Reporting bugs

Please use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml).

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.
