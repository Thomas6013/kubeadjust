# KubeAdjust — Technical Audit v0.22.0

**Date**: 2026-03-19
**Scope**: Backend Go, Frontend React/TS, Infrastructure (Docker, CI/CD), Architecture
**Method**: Full source read of all `.go`, `.ts`, `.tsx` files + Dockerfiles + CI workflows

---

## Executive Summary

KubeAdjust is a **solid MVP**. For a read-only Kubernetes dashboard, the architecture is clean: clear backend/frontend separation, zero heavy dependencies on the Go side (no client-go, no framework beyond Chi), nonce-based CSP, proper token forwarding. The CLAUDE.md is exceptional — it serves as both spec and living roadmap.

**Strengths**:
- Minimalist and consistent architecture (3 Go deps, no UI library, no charting lib)
- Security well above average for an MVP: CSP nonce, path traversal prevention, PromQL injection whitelist, LimitReader everywhere, configurable CORS
- OIDC flow well implemented with CSRF protection, custom HS256 session JWT (no external JWT library)
- K8s client retry with exponential backoff, 4xx/5xx distinction
- Clean Go package structure, readable code
- Frontend well decomposed after recent refactors (Sidebar, Topbar, CircleGauge, PodBar)
- Comprehensive test coverage on critical paths (OIDC, middleware, parsers)

**Key concern**: The project is at a turning point — it must choose between staying a lean MVP or hardening for production. The sections below detail the trade-offs.

---

## 1. Bugs Found

### BUG: `GetPodMetrics` ignores cluster URL in multi-cluster mode

- **File**: `handlers/resources.go:248`
- **Severity**: Medium (data correctness)
- **Issue**: `k8s.New(middleware.TokenFromContext(r.Context()), "")` passes `""` instead of `middleware.ClusterURLFromContext(r.Context())`. In multi-cluster mode, this endpoint always queries the default cluster's metrics-server, not the requested cluster.
- **Fix**: `k8s.New(middleware.TokenFromContext(r.Context()), middleware.ClusterURLFromContext(r.Context()))`

### BUG: `frontend/package.json` version is `0.2.0`

- **File**: `frontend/package.json:3`
- **Severity**: Low (cosmetic, npm package is private)
- **Issue**: Should be `0.22.0` to match `Chart.yaml` and `version.ts`.

---

## 2. Security

### What's Good

| Aspect | Detail |
|---|---|
| Token safety | Never logged, never stored server-side |
| CSP | Nonce-based per request, no `unsafe-eval` |
| Path traversal | `..`, `//`, `\0` rejected in frontend API proxy |
| PromQL injection | Whitelist `[a-zA-Z0-9._-]` — conservative and correct |
| K8s API path encoding | `url.PathEscape()` on all interpolated segments |
| Response cap | `io.LimitReader` 10 MB on all K8s + Prometheus responses |
| OIDC CSRF | State cookie httpOnly, 5 min TTL |
| Rate limiting | Throttle(20) global, Throttle(10) on OIDC public endpoints |
| Error messages | Generic to clients, detailed server-side via `log.Printf` |
| XSS prevention | All JSX uses `{}` expressions (React auto-escapes), no `dangerouslySetInnerHTML` |
| No credential leakage | Only Authorization + X-Cluster + session cookie forwarded in proxy |

### To Improve

| Priority | Issue | File | Detail |
|---|---|---|---|
| **High** | Base images without digest pinning | `backend/Dockerfile`, `frontend/Dockerfile` | `golang:1.26-alpine` and `node:25-alpine` are floating tags. Supply chain risk. **Fix**: pin with `@sha256:...` |
| **High** | `SESSION_SECRET` in plaintext env var | `main.go:67` | Anyone with pod spec access can forge session JWTs. Inevitable with K8s env vars, but a Secret file mount would be safer. |
| **Medium** | `style-src 'unsafe-inline'` in CSP | `proxy.ts:10` | Required by Next.js CSS Modules inline style injection. Known compromise, but weakens CSP. |
| **Medium** | No seccomp profile | Helm chart (separate repo) | Neither `seccompProfile: RuntimeDefault` nor `fsGroup`. Already in backlog. |
| **Medium** | `sharedTransport` with global `InsecureSkipVerify` | `k8s/client.go:19` | Flag read once at package init. If one cluster needs `KUBE_INSECURE_TLS`, all clusters get it. **Fix**: per-cluster TLS config. |
| **Medium** | No HTTPS validation on OIDC redirect URL | `handlers/oidc.go:36-42` | `redirectURL` from env var not validated as HTTPS. A misconfiguration allowing HTTP could leak authorization codes. |
| **Low** | No length validation on `X-Cluster` header | `middleware/cluster.go` | A maliciously long header isn't truncated. Not exploitable, but a bound would be clean. |
| **Low** | `.env.example` incomplete for OIDC mode | `.env.example` | Only 6 vars shown; OIDC adds 8 more (`OIDC_ENABLED`, `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, etc.). Developers may miss required vars. |

---

## 3. Performance

### What's Good

- Connection pooling on K8s client (`MaxIdleConnsPerHost: 20`) and Prometheus (`MaxIdleConnsPerHost: 10`)
- `ListAllPods` excludes `Succeeded`/`Failed` at the K8s API level via `fieldSelector`
- `errgroup.SetLimit(5)` for kubelet calls
- Frontend: `useMemo` on `visibleDeployments`, `computeSuggestions`, sparkline SVG paths
- Auto-refresh pauses when tab is hidden or a fetch is already in flight
- Eager namespace-wide history fetch (single Prometheus call, not per-pod)

### Issues

| Priority | Issue | Impact | File |
|---|---|---|---|
| **High** | **N+1 kubelet calls** | `GetNodeSummary()` called per node in `resources.go:126-160`. 50-node cluster = 50 HTTP calls (bounded to 5 concurrent). | `handlers/resources.go` |
| **High** | **`ListAllPods` + `ListAllPodMetrics` in `GetNodePods`** | Each "Pods" click on a node fetches ALL cluster pods + ALL metrics, then filters in Go. | `handlers/nodes.go:174-193` |
| **High** | **`GetNamespaceStats` fetches all cluster pods** | Iterates over every pod in every namespace. On a 5000-pod cluster, that's several MB parsed per call. | `handlers/namespaces.go:72-122` |
| **High** | **Zero caching** | No backend cache at all. Every request = direct K8s API calls. Auto-refresh every 30s × 10 users = 200+ K8s API calls/min. | Global |
| **Medium** | **No frontend virtualization** | 100+ workloads rendered in a single list. No `react-window` or pagination. | `dashboard/page.tsx` |
| **Medium** | **`QueryRange` and `QueryRangeMulti` duplicate HTTP logic** | Prometheus response parsing is copy-pasted between the two methods. | `prometheus/client.go:96-189` |
| **Low** | **`parseValues()` exists but `QueryRange` has its own inline version** | Minor duplication. | `prometheus/client.go:132-150 vs 203-224` |

### Cache Recommendation

The single biggest quick win: **in-memory TTL cache** (~15-30s) on:
1. `ListAllPods()` — used by `/api/nodes`, `/api/nodes/{node}/pods`, `/api/namespaces/stats`
2. `ListNodes()` + `ListNodeMetrics()` — stable over short windows
3. `GetNodeSummary()` — most expensive (kubelet proxy)

A simple `sync.Map` + `time.Time` is sufficient for an MVP. No Redis needed.

---

## 4. Code Quality & Refactoring

### Backend Go

| Aspect | Verdict | Detail |
|---|---|---|
| Package structure | Good | `handlers/`, `middleware/`, `resources/`, `k8s/`, `prometheus/`, `oidc/` — clean separation |
| Error handling | Mixed | Good `jsonError` + `log.Printf` pattern, but `ParseCPUMillicores` and `ParseMemoryBytes` silently swallow parse errors (`_ = strconv.Parse...`) |
| K8s types | Needs split | `client.go` is 454 lines; ~250 are type definitions. Deserves a separate `k8s/types.go` |
| errgroup | Inconsistent | `resources.go` uses `errgroup.WithContext` (ignores ctx), `prometheus/client.go` uses `new(errgroup.Group)`. Should standardize. |
| `parseMemoryBytes` for pod count | Fragile | `handlers/nodes.go:118` — works because pod count is a plain integer, but semantically wrong |
| Response helpers | Good | `jsonOK`/`jsonError` centralized in `namespaces.go`, used everywhere |
| Best-effort errors not logged | Missing | `handlers/resources.go:55,62,69,76,83,90` — errors swallowed with `return nil` but never logged. Should `log.Printf` before returning nil |
| OIDC handlers bypass `jsonOK`/`jsonError` | Inconsistent | `handlers/oidc.go:73,141,154` — direct `json.NewEncoder(w).Encode()` calls without checking return value |
| 10 MB limit magic number | Duplicated | `k8s/client.go:82`, `prometheus/client.go:112,170` — same `10<<20` literal in 3 places. Extract to constant |
| Concurrency | Correct | All mutex usage verified correct. No data races in current code. |

### Frontend TypeScript

| Aspect | Verdict | Detail |
|---|---|---|
| `dashboard/page.tsx` | Improved | ~460 lines after Sidebar/Topbar extraction. Dense but acceptable. 23 state variables + 6 refs. |
| State management | Adequate | Many `useState` + `useRef` + `useEffect` interleaved. A `useReducer` or Zustand store would simplify, but not required at this scale. |
| Prop drilling | Moderate | `Topbar` receives 14 props, `Sidebar` receives 10. Classic pattern; a Context would help but isn't critical. |
| Type safety | Good | Comprehensive interfaces in `api.ts`, no `any` visible, proper props interfaces on all components |
| CSS Modules | Consistent | No CSS-in-JS, no Tailwind. Clean approach. |
| Memoization | Good | `useMemo` on all expensive computations. `generationRef` prevents stale fetches in PodRow. |
| No error boundaries | Missing | No React error boundaries or Suspense fallbacks. A component crash takes down the whole page. |
| `api.ts:119` uses raw `sessionStorage` | Inconsistent | `safeGetItem` exists in `storage.ts` but `apiFetch` accesses `sessionStorage` directly |

### Dead Code

| File | Dead code | Detail |
|---|---|---|
| `k8s/client.go:295` | `KubeletVersion` in `NodeInfo` struct | Field present but never used frontend-side (removed from `NodeOverview` in v0.17.0, remains in K8s type) |
| `handlers/nodes.go:200-201` | Redundant `Succeeded`/`Failed` check | `ListAllPods()` already filters via `fieldSelector` — Go-side check is dead logic |
| `prometheus/client.go:203` | `parseValues()` function | Defined at package level but `QueryRange` (line 132-150) has its own inline copy |
| `SparklineModal.tsx:17-27` | `fmtVal()` | Duplicates `suggestions.ts:fmtSuggested()` formatting logic |

---

## 5. Maintainability

### Strengths

- **CLAUDE.md is exceptional** — covers architecture, conventions, known bugs, and resolutions. A true living document.
- **CHANGELOG.md is thorough** — each version documents the "why", not just the "what".
- **Existing tests**: OIDC session (7 cases), middleware auth (6 cases), parsers, validators. Good coverage on critical paths.
- **Frontend test file exists**: `suggestions.test.ts` with 23 test cases covering `resourceStatus`, `storageStatus`, `buildHistoryMap`, `computeSuggestions`.
- **Clear conventions**: no client-go, no CSS framework, no charting lib.

### Weaknesses

| Priority | Issue | Detail |
|---|---|---|
| **High** | **No handler/K8s client tests** | `ListDeployments`, `ListNodes`, `GetNodePods`, `GetNamespaceStats` — all orchestration is untested. An aggregation bug would be invisible. |
| **High** | **No frontend component tests** | All 14 components untested. Visual regressions and type errors only caught at runtime. vitest + @testing-library/react not configured. |
| **Medium** | **Magic numbers in suggestions.ts** | 0.90, 0.70, 0.35, 3x, 1.1x, 1.3x, 1.4x, 1.5x — 8 hardcoded thresholds. |
| **Medium** | **`openCards` unbounded in sessionStorage** | `Set<string>` grows indefinitely across sessions. |
| **Medium** | **No Helm lint in CI** | Chart is in a separate repo, but nothing validates its correctness here. |
| **Medium** | **Taint colors hardcoded in JS** | `NodeCard.tsx:24-33` — RGBA literals in JavaScript instead of CSS custom properties. |
| **Low** | **CLAUDE.md is very long** | ~500 lines. Good signal/noise ratio, but the "Resolved" section is ~150 lines of closed bugs. Consider archiving to `RESOLVED.md`. |
| **Low** | **No accessibility** | No `:focus-visible` styles, limited ARIA labels, no `cursor: not-allowed` on disabled buttons, sidebar not responsive. |

---

## 6. Infrastructure

### Docker

| Aspect | Verdict | Detail |
|---|---|---|
| Multi-stage builds | Good | Backend: builder → scratch. Frontend: deps → builder → runner. Efficient layer caching. |
| Non-root user | Good (frontend) | `nextjs:1001` user. Backend runs as root in scratch (acceptable — no shell/binaries). |
| Build optimization | Good | `-ldflags="-s -w"` strips symbols (~30-40% smaller binary). Cross-compilation via `BUILDPLATFORM`/`TARGETARCH`. |
| Image signing | Good | Cosign keyless signing + SBOM generation |
| Digest pinning | Missing | Floating tags `golang:1.26-alpine`, `node:25-alpine`. Supply chain risk. |

### CI/CD

| Aspect | Verdict | Detail |
|---|---|---|
| Parallel jobs | Good | Backend and frontend jobs run in parallel |
| Linting | Good | `go vet`, `golangci-lint`, `npm run lint` all active |
| Testing | Good | `go test`, frontend build — all in CI |
| Tag-based publish | Good | Docker images only on `*.*.*` tag push (no unversioned churn) |
| Multi-arch | Good | amd64 + arm64 via QEMU + buildx |
| Missing | `go mod verify` | Optional — guards against dependency tampering |
| Missing | Dependency scanning | No `npm audit` or Go vuln check in CI. GitHub Dependabot covers this partially. |

---

## 7. Architecture — MVP Trade-offs

### Good for an MVP

1. **Raw HTTP K8s API** — no client-go = no dependency hell, no K8s version coupling. But no watch/informer, no built-in cache, no auto typing.
2. **sessionStorage** — simple, no complex cookie auth. But no cross-tab persistence.
3. **No database** — stateless backend. But no suggestion history, no persistent user preferences.
4. **Prometheus optional** — works without. Good modularity choice.

### What Will Break at Scale

1. **No cache** — backend is a pure passthrough. Every request = N K8s API calls. Beyond ~10 concurrent users or ~20 nodes, the K8s API server will throttle.
2. **Systematic `ListAllPods`** — 3 different endpoints fetch all cluster pods. On a production cluster (5000+ pods), that's 3x a ~5-10 MB response per refresh cycle.
3. **Kubelet summary API** — designed for debugging, not monitoring. Slow, not cached by the API server, frequent timeouts. Long-term fix: metrics-server or Prometheus for storage metrics.
4. **Frontend single list** — beyond ~100 workloads, rendering will lag. `react-window` is the standard fix.

---

## 8. Prioritized Action Plan

If I had to do 5 things, in this order:

### 1. Fix the `GetPodMetrics` multi-cluster bug (Effort: 5 min)
```go
// handlers/resources.go:248 — change:
client := k8s.New(middleware.TokenFromContext(r.Context()), "")
// to:
client := k8s.New(middleware.TokenFromContext(r.Context()), middleware.ClusterURLFromContext(r.Context()))
```

### 2. In-memory TTL cache for backend (Impact: HUGE, Effort: ~2h)
```go
type cacheEntry[T any] struct {
    data      T
    fetchedAt time.Time
}
```
Cache `ListAllPods()` 30s, `ListNodes()` 30s, `GetNodeSummary()` 60s. Auto-invalidate. No complex logic needed for a read-only dashboard.

### 3. Extract K8s types into `k8s/types.go` (Impact: readability, Effort: 30min)
- `client.go` drops from 454 to ~150 lines
- Types become independently importable

### 4. Handler tests with `httptest.Server` (Impact: confidence, Effort: 1 day)
- Mock the K8s API server
- Test `ListDeployments`, `ListNodes`, `GetNamespaceStats`
- Validate aggregation logic, not just parsing

### 5. Make `ParseCPUMillicores` / `ParseMemoryBytes` return errors (Impact: debuggability, Effort: 1h)
- `ParseCPUMillicores("garbage")` silently returns 0
- Risk: a pod with an invalid CPU request is invisible in suggestions

---

## 9. Open Questions

1. **Target cluster size?** — If <20 nodes / <500 pods, the current design holds. Beyond that, caching becomes mandatory.

2. **Is the external Helm chart tested?** — No `helm lint` or `ct lint` in either this repo's CI or (apparently) the helm repo. A broken chart = broken deployment.

3. **`ParseMemoryBytes` for pod count** (`nodes.go:118`) — it's an int, not memory. Works by accident. Want a dedicated `parseInt`?

4. **Is `style-src 'unsafe-inline'` acceptable long-term?** — Next.js CSS Modules force this. Alternative: hash styles, but complex with the current build pipeline.

5. **Session JWT 8h with no refresh** — If a user leaves a tab open, they lose their session after 8h with no warning. A refresh token or extend-on-activity would be smoother.

6. **`frontend/package.json` version tracking** — Should this be automated (e.g., bumped alongside `Chart.yaml` and `version.ts`)?

---

## 10. Metrics

| Metric | Value |
|---|---|
| Backend Go files | 28 |
| Backend LOC (approx) | ~3,500 |
| Frontend TS/TSX files | 41 |
| Frontend LOC (approx) | ~3,500 |
| Go dependencies (direct) | 3 (chi, cors, errgroup) + 1 OIDC |
| Frontend components | 14 |
| Custom hooks | 1 (useSessionState) |
| Backend test files | 7 |
| Frontend test files | 1 (23 test cases) |
| Known bugs (CLAUDE.md backlog) | 1 high, 0 medium |
| Known issues total (backlog) | ~25 items across all categories |

---

*Generated by Claude Opus 4.6 — 2026-03-19*
