# KubeAdjust — Audit v0.7.0

Post-hardening scan. All items from the v0.6.0 audit have been resolved.
Below are remaining and newly identified issues.

---

## Security

### S-1 — CSP uses `'unsafe-inline'` and `'unsafe-eval'` (Medium)

**File:** `frontend/next.config.mjs:31`

`'unsafe-eval'` is required by Next.js dev mode but should not ship to production. `'unsafe-inline'` on scripts undermines XSS protection. Next.js 14 supports nonce-based CSP via `middleware.ts`.

**Fix:** Implement nonce-based CSP using Next.js middleware, or at minimum remove `'unsafe-eval'` in production.

### S-2 — No rate limiting on backend endpoints (Medium)

**File:** `backend/main.go`

No rate limit on any endpoint. Each `/api/namespaces/{ns}/deployments` request fans out 7+ K8s API calls via errgroup. An attacker with a valid token could saturate the K8s API server.

**Fix:** Add `golang.org/x/time/rate` middleware or `chi/middleware.Throttle`.

### S-3 — Token in `sessionStorage` — no auto-clear on 401 (Low)

**File:** `frontend/src/app/dashboard/page.tsx:35`

An expired token stays in sessionStorage causing 401 loops. The frontend should clear sessionStorage and redirect to `/` on 401.

### S-4 — `isValidLabelValue` allows newline characters (Low)

**File:** `backend/handlers/prometheus.go:44`

The blocklist does not include `\n`/`\r`. Safer to use an allowlist regex: `^[a-zA-Z0-9_.\-]+$`.

### S-5 — `ALLOWED_ORIGINS` not validated at startup (Low)

**File:** `backend/main.go:29-33`

Trailing spaces or malformed origins silently fail to match. No startup validation.

### S-6 — `go mod tidy` in Dockerfile reduces build reproducibility (Low)

**File:** `backend/Dockerfile:5`

`go mod tidy` at build time can silently modify `go.sum`. Use `go mod download` instead.

---

## Performance

### P-1 — `ListAllPods` fetches every pod on every `/api/nodes` request (Medium)

**File:** `backend/handlers/nodes.go:46`

No caching, full cluster pod list loaded per request. Also `ListNodes`, `ListAllPods` and `ListNodeMetrics` run sequentially — should use `errgroup` like `ListDeployments`.

### P-2 — Prometheus client creates new `http.Client` per request (Minor)

**File:** `backend/prometheus/client.go:39-42`

Unlike the K8s client which now uses `sharedTransport`, the Prometheus client recreates the transport each time `prometheus.New()` is called, defeating TCP connection reuse.

**Fix:** Create the Prometheus client once at startup and pass it to handlers.

### P-3 — No `Cache-Control` headers (Minor)

The backend serves no cache headers. A short `Cache-Control: private, max-age=30` for namespace lists would reduce API load.

### P-4 — Nodes view only auto-loads once (Minor)

**File:** `frontend/src/app/dashboard/page.tsx:89`

`if (nodes.length === 0) loadNodes()` — switching away and back never triggers a reload. Stale data shown silently.

---

## Maintainability

### M-1 — `frontend/Dockerfile` misleading `BACKEND_URL` ARG/ENV comment (Medium)

**File:** `frontend/Dockerfile:12-13`

Comment says "baked at build time" but `next.config.mjs` reads it at runtime in standalone mode. Remove the ARG/ENV and rely on runtime env var only.

### M-2 — ESLint strictness not enforced (Low)

**File:** `.github/workflows/ci.yml:45`

`npm run lint` does not use `--max-warnings=0`. Warnings pass silently.

**Fix:** `npm run lint -- --max-warnings=0` or update package.json lint script.

### M-3 — `SuggestionPanel` uses array index as React key (Low)

**File:** `frontend/src/components/SuggestionPanel.tsx:71`

Use a composite key like `${s.deployment}/${s.container}/${s.resource}/${s.kind}`.

### M-4 — `ResourceBar` headroom sets both `millicores` and `bytes` simultaneously (Low)

**File:** `frontend/src/components/ResourceBar.tsx:99`

Constructed object carries a wrong field for the non-active unit. Cosmetic but misleading.

### M-5 — `nodes.go` reuses `parseMemoryBytes` to parse pod count (Low)

**File:** `backend/handlers/nodes.go:98`

`MaxPods: int(parseMemoryBytes(...))` — works because plain integers fall through, but semantically fragile.

### M-6 — No `readinessProbe` on frontend container (Low)

**File:** `helm/kubeadjust/templates/deployment.yaml:103-107`

Only `livenessProbe` present. Traffic can arrive before Next.js finishes startup, causing 502s during rolling updates.

### M-7 — `ResourceBar.tsx` missing `"use client"` directive (Low)

Inconsistent with other components in the same directory. Works today but fragile.

---

## Resolved in v0.7.0

- [x] CORS configurable via `ALLOWED_ORIGINS`
- [x] K8s errors no longer leaked to clients
- [x] `io.LimitReader` 10 MB cap on all response bodies
- [x] Sequential K8s calls parallelized with `errgroup`
- [x] Shared `http.Transport` for K8s client
- [x] `KUBE_INSECURE_TLS` startup warning
- [x] Unit tests for parsers and PromQL validation
- [x] golangci-lint + eslint in CI
- [x] CSP + security headers added
- [x] `.env.example` created
- [x] Code of Conduct added
- [x] SBOM + cosign image signing in Docker publish
