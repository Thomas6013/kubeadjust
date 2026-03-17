# Contributing to KubeAdjust

Thank you for taking the time to contribute!

## Getting started

1. Fork the repository and clone your fork
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes (see development setup below)
4. Open a pull request against `main`

## Development setup

### Prerequisites

- Go 1.26+
- Node.js 25+
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
```

## Guidelines

- **Backend**: No client-go. All Kubernetes API calls go through `k8s/client.go` (raw HTTP). Keep the backend stateless — no caching, no database.
- **Frontend**: No UI library. CSS Modules only. No charting libraries — sparklines use pure SVG.
- **Suggestions**: Thresholds live in `frontend/src/lib/suggestions.ts`. Keep them configurable.
- **RBAC**: Any new Kubernetes resource access must be added to `rbac.yaml` in the [kubeadjust-helm](https://github.com/Thomas6013/kubeadjust-helm) chart repository.

## Versioning

When bumping a release, update **both**:

1. `frontend/src/lib/version.ts` — `APP_VERSION` constant (displayed in the topbar)
2. `appVersion` in `Chart.yaml` in the [kubeadjust-helm](https://github.com/Thomas6013/kubeadjust-helm) repository

Docker images are published via `docker-publish.yml` when a `*.*.*` git tag is pushed:
```bash
git tag 0.22.0 && git push origin 0.22.0
```

## Pull request checklist

- [ ] `go vet ./...` passes in `backend/`
- [ ] `go test ./...` passes in `backend/`
- [ ] `npm run build` passes in `frontend/`
- [ ] `npm run lint` passes in `frontend/`
- [ ] New env vars are documented in `README.md` and `CLAUDE.md`
- [ ] `APP_VERSION` bumped in `frontend/src/lib/version.ts` (if releasing)
- [ ] `CHANGELOG.md` updated (if releasing)

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).
Please read it before participating.

## Reporting bugs

Please use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml).

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 License.
