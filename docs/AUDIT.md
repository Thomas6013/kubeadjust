# KubeAdjust — Technical Audit v0.26.0

**Date**: 2026-06-01
**Scope**: Backend Go, Frontend React/TS, Infrastructure (Docker, CI/CD), Architecture, Product
**Method**: Full source read of all `.go`, `.ts`, `.tsx` files + Dockerfiles + docs. `go test ./...` green (5 packages pass; `k8s` and `prometheus` have no test files).
**Baseline**: branch `feature/0.26.0`, released version v0.25.0.

> Supersedes the v0.22.0 audit. Resolved items from the previous audit (e.g. `GetPodMetrics` cluster URL, `package.json` version) are no longer listed.

---

## Executive Summary

KubeAdjust remains a **solid, well-engineered MVP**. The architecture is clean (3 Go deps, no client-go, no UI/charting library), the code is idiomatic and unusually well-commented — a developer with no AI assistance can follow the "why" behind non-obvious decisions (kubelet token rotation, NFS `statfs` caveat, KeepAlive transport, scroll race). No critical correctness bug was found.

This audit focuses on the gaps that matter as the project moves toward production: one real cross-user security issue in token mode, one dead feature path in the UI, plus factorisation, dead code, maintainability and test-coverage opportunities.

**Priority shortlist**

| # | Severity | Topic |
|---|----------|-------|
| S-1 | 🔴 High | Cross-user cache leak in token mode (RBAC bypass) |
| F-1 | 🔴 High | Node-capacity capping of suggestions never runs in namespace view |
| S-2 | 🟠 Medium | Backend container runs as root (scratch image, no `USER`) |
| S-3 | 🟠 Medium | Docker base images not digest-pinned |
| Fa-1…5 | 🟡 Low | Code factorisation opportunities |
| D-1…3 | 🟡 Low | Dead code / stale docs |
| M-1 | 🟡 Low | `dashboard/page.tsx` god-component |
| T-1…5 | 🟡 Low | Test coverage gaps |

---

## 1. Security

### 🔴 S-1 — Cross-user cache leak in token mode (RBAC bypass)

- **File**: `k8s/cache.go`, used by `k8s/client.go` (`ListAllPods`, `ListNodes`, `ListNodeMetrics`, `ListAllPodMetrics`, `GetNodeSummary`)
- **Issue**: All caches are keyed **only by `c.apiServer`** (cluster URL), never by the caller's token:

  ```go
  func (c *Client) ListAllPods(ctx) (*PodList, error) {
      if v, ok := allPodsCache.get(c.apiServer); ok { return v, nil } // no token in key
  ```

  In **token mode** (`middleware.BearerToken`), multiple users with different Kubernetes RBAC hit the same cluster URL. User A (broad RBAC) populates the cache; User B (restricted RBAC) is then served A's cluster-wide node/pod data via the same cache key — data B is not authorised to list. This is a **cross-user data leak / privilege escalation** on `/nodes`, `/nodes/{node}/pods`, `/namespaces/stats`.
- **Not affected**: OIDC mode and managed-SA mode, where every request legitimately uses the same shared SA token (caching is by design there).
- **Fix**: In token mode, incorporate a token fingerprint into the cache key (e.g. `sha256(token)[:16] + ":" + apiServer`), or disable these caches when no managed SA token is configured. Recommended: token-fingerprint key — transparent and keeps the perf win for repeated calls by the same user.

### 🟠 S-2 — Backend container runs as root

- **File**: `backend/Dockerfile`
- **Issue**: Final stage is `FROM scratch` with no `USER` directive → runs as UID 0. The frontend image correctly sets `USER nextjs`. A pod `securityContext` could enforce `runAsNonRoot`, but the Helm chart lives in a separate repo, so this image lacks defense-in-depth on its own.
- **Fix**: Add `USER 65534:65534` (nobody) to the scratch stage. Static binary, no filesystem writes needed → no other change required.

### 🟠 S-3 — Docker base images not digest-pinned

- **Files**: `backend/Dockerfile` (`golang:1.26-alpine`), `frontend/Dockerfile` (`node:25-alpine`)
- **Issue**: Floating tags = supply-chain risk; builds are not reproducible.
- **Fix**: Pin with `@sha256:…` and let Renovate bump the digests.

### 🟡 S-4 — Session JWT is minimal

- **File**: `oidc/session.go`
- **Notes**: No `iss`/`aud`/`nbf` claims; no revocation or refresh (already in backlog). **Positive**: `VerifySessionToken` ignores the JWT header and always recomputes with HS256 — so there is **no `alg:none` / algorithm-confusion vulnerability**. Acceptable for an 8h read-only session. Document that `SESSION_SECRET` must never be reused across environments.

### ✅ Confirmed strengths

Nonce-based CSP (`proxy.ts`), path-traversal rejection in the API proxy, PromQL injection whitelist (`IsValidLabelValue`), `io.LimitReader` 10 MB on both K8s and Prometheus clients, generic client-facing errors, token never logged, OIDC `state` CSRF check in the callback, short-lived (30s) `sameSite=strict` path-scoped init cookie.

---

## 2. Functional gaps & bugs

### 🔴 F-1 — Node-capacity capping of suggestions never runs in namespace view

- **Files**: `frontend/src/app/dashboard/page.tsx` (`loadNodes` gated at L167–169; `SuggestionPanel` rendered only in namespace view at L565), `frontend/src/lib/suggestions.ts` (`maxNodeCapacity`, `suggestCapped`)
- **Issue**: `nodes` state is populated **only when `view === "nodes"`**. The `SuggestionPanel` is rendered exclusively in the *namespaces* view and receives `nodes={nodes}`, which stays `[]` until the user visits the Nodes tab. Therefore `computeSuggestions` gets `nodeCap = undefined`, every `suggestCapped` returns the uncapped value, and the "capped to node capacity" / "Migrate to larger node" / "fits on N/M nodes" outcomes **never appear** during normal use. The entire `maxNodeCapacity` code path is effectively dead UX.
- **Fix**: Load nodes lazily as soon as a token exists, independent of the active view (the result is cached 30s server-side anyway):

  ```ts
  useEffect(() => { if (token && nodes.length === 0) loadNodes(true); }, [token, nodes.length, loadNodes]);
  ```

### 🟡 F-2 — No pagination / virtualisation (backlog)

`dashboard/page.tsx` renders all workloads at once → jank on 100+ workloads. Fix: react-window or "load more".

### 🟡 F-3 — `/healthz` is not a real readiness check

`main.go:148` always returns 200 without touching the K8s API. A separate `/readyz` that performs a fast `/api` probe would make readiness probes meaningful. Optional.

---

## 3. Code factorisation

### Fa-1 — `prometheus/client.go`: `QueryRange` and `QueryRangeMulti` are near-duplicates

~30 lines duplicated (params build, fetch, LimitReader, status handling, unmarshal). Extract:

```go
func (c *Client) queryRange(query string, tr TimeRange) (promRangeResponse, error)
```

`QueryRange` returns `Result[0]`, `QueryRangeMulti` returns `Result`. Removes ~50 lines.

### Fa-2 — Repeated JSON error boilerplate in middleware

`middleware/auth.go` and `middleware/session.go` repeat the `Header().Set / WriteHeader / Write([]byte(...))` block ~4×. Handlers already have `jsonError`; add a shared `middleware.writeJSONError(w, code, msg)`.

### Fa-3 — Pod→container→usage metrics map built three times

Same pattern in `handlers/resources.go:117-125`, `handlers/nodes.go:192-199`, `resources/workloads.go:71-77`. Extract `BuildContainerUsageMap(*PodMetricsList) map[string]map[string]ContainerUsage`.

### Fa-4 — `suggestions.ts`: "increase-or-migrate" pattern repeated 3×

The `if (capped && s.suggestedRaw <= base) { …Migrate… } else { …Increase… }` block appears for limit / trend / request (L204, L224, L257). Factor into a `pushIncreaseOrMigrate(...)` helper.

### Fa-5 — Ratio→colour/label logic duplicated in the frontend

The `>5 → red / >2 → orange` thresholds are hard-coded **three times** in `dashboard/page.tsx` (overview sort L422-431, badge L436-437, namespace header L505-511). Extract `ratioSeverity(ratio): { color, label, order }` into `lib/`.

---

## 4. Dead code

- **D-1 — `usagePct` (`frontend/src/lib/api.ts:268`)**: exported but used nowhere (only `storagePct` and `fmtStorage` are consumed). Remove.
- **D-2 — `docs/IMPROVE.md`**: a frozen v0.13.0 audit whose items are already resolved (nonce CSP, path validation…). Stale and confusing. Delete or move to an `archive/` folder.
- **D-3 — `handlers.GetPodMetrics` + route `/namespaces/{ns}/metrics`** (`main.go:213`): labelled "useful for debugging" but never called by the frontend (`api.ts` has no method for it). Remove, or keep and clearly document it as a debug-only endpoint.

---

## 5. Maintainability & comments

Overall **very good**: systematic Go doc-comments, meaningful "why" comments. The main hotspot:

### M-1 — `dashboard/page.tsx` (579 lines) is a god-component

~15 `useEffect`, 6 sync `useRef`, cluster-switch logic, URL sync, overview computation, and three inline views in one file. Hard to read and to test. Suggested split:

- `useDashboardData(token, cluster)` — namespaces, stats, deployments, nodes, history.
- `useClusterSwitch()` — all of `handleClusterSwitch` + per-cluster token handling.
- `useUrlSync(cluster, view, selectedNs)` — the `router.replace` effect.
- `OverviewView` / `NodesView` / `NamespaceView` components to lift the per-view JSX out.

This brings the page under ~200 lines and makes each piece independently testable.

### M-2 — Suggestion thresholds hard-coded (backlog)

`0.90 / 0.70 / 0.35 / 3× / 1.1` scattered through `suggestions.ts`. Extract a `THRESHOLDS` object at the top of the file for readability and future tuning.

---

## 6. Test coverage (suggestions only)

Well covered on **pure calculation** (parse, validate, format, workloads, nodes, oidc/session, middleware/session, `suggestions.test.ts`). Gaps, by priority:

- **T-1 (high) — `k8s/client.go`**: retry/backoff, 4xx/5xx distinction (`isClientError`), LimitReader. Testable with an `httptest.Server` that returns 500 then 200, plus a >10 MB body. Currently zero tests on the networking path.
- **T-2 — `k8s/cache.go`**: TTL, expiry, concurrency (`go test -race`). Essential if S-1 is fixed.
- **T-3 — `prometheus/client.go`**: `parseValues` (malformed pairs), `ParseTimeRange`, range parsing. Simple `httptest`.
- **T-4 — handlers `resources`/`nodes`/`namespaces`**: errgroup orchestration + best-effort behaviour (one sub-call fails → partial response, not 500). Mock K8s via `httptest`.
- **T-5 — frontend components** (backlog): none tested. Start with `SuggestionPanel` (filters/categories) and `dashboard` (cluster switch). vitest + @testing-library/react.

---

## 7. Product / MVP & business

The positioning is right: a **visual, read-only VPA/Goldilocks with no CRD and no agent**, using token forwarding. The differentiator is *zero server state, zero intrusive install, OIDC + multi-cluster*. That is exactly what Goldilocks (ugly) and the VPA (no viz, intrusive) lack.

Three levers to go from MVP to product:

1. **€ cost translation** — turn CPU/RAM suggestions into estimated monthly savings (configurable price/core/month). This is the hook that wins managers, not just SREs. Low effort, high demo impact.
2. **Grouped actionable export** — a "patch bundle" (kubectl set / values.yaml / PR) for *all* suggestions in a namespace, not just per-container. `toKubectlCmd` already exists per item; aggregate it.
3. **Optional trend persistence** — today everything depends on client-side Prometheus. A lightweight "historical snapshot" mode (even a ConfigMap or S3 object) would enable weekly reporting — the basis of a paid/SaaS tier.

Keep strict read-only as the central **trust anchor** ("we never touch your cluster") and **never** add write verbs to the ClusterRole.

---

## 8. Documentation

README (171 lines) + CHANGELOG + focused docs strike a good size balance. Two frictions:

- `docs/IMPROVE.md` is stale (see D-2) and muddies the picture.
- Four docs (`SUGGEST.md`, `auto-refresh.md`, `node-pods.md`, `IMPROVE.md`) are **not referenced** in the CLAUDE.md layout or the README. `SUGGEST.md` (the suggestion-rules table) is valuable — link it from the README. The two feature docs (auto-refresh, node-pods) would be better folded into a "Features" section of the README so a newcomer understands quickly without four scattered files.
- **Missing**: a one-image diagram of the auth flow (token vs OIDC vs managed-SA) at the top of the README — the hardest thing for a newcomer to grasp quickly given the three modes.

---

## Appendix — files reviewed

Backend: `main.go`, `k8s/{client,cache,types}.go`, `middleware/{auth,session,cluster}.go`, `oidc/session.go`, `handlers/{resources,nodes,namespaces,prometheus,oidc,auth,clusters}.go`, `resources/{parse,workloads}.go`, `prometheus/client.go`.
Frontend: `app/dashboard/page.tsx`, `lib/{api,suggestions}.ts`, `proxy.ts`, `app/api/[...path]/route.ts`, `app/auth/callback/route.ts`.
Infra/docs: `backend/Dockerfile`, `frontend/Dockerfile`, `README.md`, `CHANGELOG.md`, `docs/*`.
