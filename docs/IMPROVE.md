# KubeAdjust — Audit v0.12.0

Post-v0.12.0 scan. Covers security, performance, robustness, and maintainability.

---

## Security

### S-1 — CSP uses `'unsafe-inline'` and `'unsafe-eval'` (High)

**File:** `frontend/next.config.mjs:23`

`'unsafe-eval'` is required by Next.js dev mode but should not ship to production. `'unsafe-inline'` on scripts undermines XSS protection.

**Fix:** Implement nonce-based CSP using Next.js middleware, or at minimum remove `'unsafe-eval'` in production.

### S-2 — PromQL injection: blacklist too weak (Medium)

**File:** `backend/handlers/prometheus.go:73`

`isValidLabelValue()` only blocks `"{}\\` — newlines or unexpected chars could bypass.

**Fix:** Whitelist `^[a-zA-Z0-9._-]+$` instead of blacklist.

### S-3 — No path validation in frontend proxy (Medium)

**File:** `frontend/src/app/api/[...path]/route.ts:22`

SSRF mitigated by env-controlled `BACKEND_URL`, but path traversal (`../`) not validated.

**Fix:** Reject paths containing `..`, `//`, or null bytes.

### S-4 — No NetworkPolicy in Helm chart (Medium)

**File:** missing `templates/networkpolicy.yaml`

No network segmentation — backend accessible from any pod in the cluster.

**Fix:** Optional NetworkPolicy template: frontend→backend:8080, backend→K8s API outbound.

### S-5 — `ALLOWED_ORIGINS` not in Helm deployment template (Medium)

**File:** `helm/kubeadjust/templates/deployment.yaml`

Users must remember to set CORS origins manually via `backend.env`. Easy to forget.

**Fix:** Add dedicated `backend.allowedOrigins` values key, injected in deployment template.

### S-6 — CORS origin split doesn't trim whitespace (Low)

**File:** `backend/main.go:30`

`"https://a.com, https://b.com"` → space breaks match.

**Fix:** Add `strings.TrimSpace()` when splitting.

### S-7 — Frontend missing `readOnlyRootFilesystem` (Low)

**File:** `helm/kubeadjust/templates/deployment.yaml`

Backend has it, frontend doesn't.

**Fix:** Add securityContext with emptyDir for Next.js temp writes.

---

## Performance

### P-1 — `ListAllPods` fetches all cluster pods per `/api/nodes` request (Medium)

**File:** `backend/handlers/nodes.go:46`

No caching — full cluster pod list loaded per request. O(cluster size).

**Fix:** Short TTL in-memory cache (30s), or field-selector to exclude terminated pods.

### P-2 — No virtualisation/pagination for large clusters (Medium)

**File:** `frontend/src/app/dashboard/page.tsx`

100+ workloads/nodes render in a single list without virtualisation.

**Fix:** `react-window` or "load more" pagination.

### P-3 — No retry on transient K8s API failures (Medium)

**File:** `backend/k8s/client.go:45`

Single network hiccup = full request failure.

**Fix:** Exponential backoff (max 3 attempts, 5xx only).

### P-4 — Sparkline min/max recalculated every render (Low)

**File:** `frontend/src/components/Sparkline.tsx:11`

**Fix:** Wrap in `useMemo`.

### P-5 — No connection pooling on Prometheus client (Low)

**File:** `backend/prometheus/client.go:84`

**Fix:** Custom Transport with `MaxIdleConnsPerHost: 10`.

---

## Robustness

### R-1 — Helm chart not linted in CI (Medium)

**File:** `.github/workflows/ci.yml`

YAML errors or missing values could reach production undetected.

**Fix:** Add `helm lint helm/kubeadjust` and optionally `ct lint`.

### R-2 — ESLint disabled in CI (Medium)

**File:** `.github/workflows/ci.yml:46`

`next lint` removed in Next.js 16, linting step skipped.

**Fix:** Configure `eslint .` directly with `eslint-config-next`.

### R-3 — `openCards` sessionStorage can grow unbounded (Low)

**File:** `frontend/src/app/dashboard/page.tsx`

**Fix:** Cap at ~100 entries, or clear on namespace switch.

### R-4 — sessionStorage writes not wrapped in try-catch (Low)

**File:** `frontend/src/app/dashboard/page.tsx`

**Fix:** Wrap `sessionStorage.setItem` for `QuotaExceededError`.

### R-5 — Silent `.catch(() => {})` on background fetches (Low)

**File:** `frontend/src/app/dashboard/page.tsx:106,143`

**Fix:** `console.warn` in dev, optional UI indicator when Prometheus fails.

---

## Maintainability

### M-1 — Magic strings for sessionStorage keys (Low)

**File:** `frontend/src/app/dashboard/page.tsx:47-70`

Storage keys repeated as strings throughout.

**Fix:** Extract to `const STORAGE_KEYS = { TOKEN: "kube-token", ... }`.

### M-2 — `parseMemoryBytes` reused to parse pod count (Low)

**File:** `backend/handlers/nodes.go:98`

Works but semantically fragile.

**Fix:** Dedicated `parsePodCount()` or `parseInt()`.

### M-3 — Suggestion thresholds hardcoded (Low)

**File:** `frontend/src/lib/suggestions.ts:86,90,96,102`

0.90, 0.70, 0.35, 3× not configurable.

**Fix:** Extract to config object.

### M-4 — Inconsistent errgroup initialisation (Low)

**Files:** `handlers/resources.go:169` vs `handlers/namespaces.go:31`

Some use `errgroup.WithContext()`, others `new(errgroup.Group)`.

**Fix:** Standardise across codebase.

---

## Resolved

- [x] ~~CORS configurable via `ALLOWED_ORIGINS`~~ — v0.7.0
- [x] ~~K8s errors no longer leaked to clients~~ — v0.7.0
- [x] ~~`io.LimitReader` 10 MB cap~~ — v0.7.0
- [x] ~~Sequential K8s calls parallelized with `errgroup`~~ — v0.7.0
- [x] ~~Shared `http.Transport` for K8s client~~ — v0.7.0
- [x] ~~Unit tests for parsers and PromQL validation~~ — v0.7.0
- [x] ~~golangci-lint + eslint in CI~~ — v0.7.0
- [x] ~~CSP + security headers added~~ — v0.7.0
- [x] ~~SBOM + cosign image signing~~ — v0.7.0
- [x] ~~`SuggestionPanel` array index as React key~~ — v0.8.0
- [x] ~~`ResourceBar.tsx` missing `"use client"`~~ — v0.8.0
- [x] ~~`BACKEND_URL` baked at build time~~ — v0.9.0 (runtime API proxy)
- [x] ~~Suggestions based on snapshot only~~ — v0.10.0 (Prometheus P95/mean)
- [x] ~~No rate limiting~~ — v0.11.0 (Chi Throttle 20 concurrent)
- [x] ~~No auto-clear of expired token on 401~~ — v0.11.0 (auto-logout + redirect)
- [x] ~~Prometheus client created per request~~ — v0.11.0 (global singleton at startup)
- [x] ~~`go mod tidy` in Dockerfile~~ — v0.12.0 (replaced with `go mod download`)
- [x] ~~No `readinessProbe` on frontend~~ — v0.12.0 (added to Helm deployment)
- [x] ~~Suggestion action labels wrong~~ — v0.12.0 (per-suggestion `action` field)
