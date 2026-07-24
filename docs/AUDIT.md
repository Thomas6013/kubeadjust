# KubeAdjust — Technical Audit

> Current audit pass: **2026-07-02**
> Previous audit pass: 2026-06-01 (narrative format, superseded structure; findings carried into the tracking table below)
> Framework: full-repo engineering audit — security, correctness, maintainability, factorisation, dead code, performance, testing, docs drift, supply chain, domain correctness. Helm chart lives in [kubeadjust-helm](https://github.com/Thomas6013/kubeadjust-helm) (not checked out — out of scope for this pass).

---

## Run History

| Pass date | Model | Score | HIGH open | New findings | Closures | Notes |
|---|---|---|---|---|---|---|
| ~2026-04 (v0.22.0) | Claude | — | 2 | — | — | Narrative audit, superseded by 2026-06-01 pass |
| 2026-06-01 | Claude | — | 2 (S-1, F-1) | 20 | — | Narrative format; S-1 cross-user cache leak, F-1 dead node-capping path |
| 2026-07-02 | Claude Fable 5 | **7.5/10** (baseline) | **0** | 14 (4 MED, 6 LOW, 4 INFO) | **8** (both HIGHs + S-2, S-3, D-1…3, T-2) | First pass in stable structure; scoring baseline |

---

## Severity Classification Rubric

| Severity | Definition | Response |
|---|---|---|
| **CRITICAL** | Active exploit possible now: RCE, full account takeover, mass data exfiltration, leaked prod credentials, ransomable data path. | Block all merges; hotfix within 24 h. |
| **HIGH** | Single-step exploit with meaningful impact, or a single fault crashes the service for all users; cross-tenant leak. | Block release; fix within 1 week. |
| **MEDIUM** | Self-inflicted DoS by one actor, partial same-scope info leak, missing rate limit, real-but-low-probability race, missing observability that will hide a future incident. | Fix within 1 sprint. |
| **LOW** | Best-practice violation with no exploitable impact today, minor info disclosure, deprecated-but-present API. | Address opportunistically; carry across passes. |
| **INFO** | Style, factorisation, future-proofing, architectural opinion. | Track only, no SLA. |

**Heuristic when in doubt:** single unauthenticated request exploits it → CRITICAL; one authenticated tenant against another → HIGH; one actor degrades service for others without a bug → MEDIUM; needs collusion/insider/physical access → LOW/INFO.

---

## Overall Assessment

**Score: 7.5/10 (baseline for this structure).** Both HIGH findings from the previous pass are verifiably fixed with tests or code evidence, and the codebase remains unusually clean for its size: 5 Go runtime deps, no client-go, no UI/charting libraries, systematic "why" comments, green `go test ./...` (7 packages) and `vitest` (36 tests). What keeps it from 8+: two MEDIUM security-posture gaps (anonymous-by-default managed mode, no HTTP server timeouts), one MEDIUM domain-correctness bug in the product's flagship actionable output (`toKubectlCmd` targets the wrong workload kind), and CI no longer runs on pull requests.

- **Closures this pass (8):** S-1 (cross-user cache leak — token-fingerprint cache key + test), S-2 (backend now `USER 65534`), S-3 (both base images digest-pinned), F-1 (nodes pre-loaded for suggestion capping), D-1/D-2/D-3 (dead code & stale doc removed), T-2 (cache tests added).
- **New findings:** 4 MEDIUM (S-5 anonymous managed default, S-6 missing server timeouts, DOM-1 kubectl command wrong kind, INFRA-1 no PR CI), 6 LOW, 4 INFO.
- **Architecture note:** two binaries (Go API + Next.js frontend) is the right decomposition for this product; no further split warranted.
- **Dimensions n/a for this project:** multi-tenant isolation (single shared-credential deployments by design — but see S-1 history: token mode *is* multi-user, now correctly isolated), data layer (no database, no migrations), legal/PII (no user data stored server-side), background jobs observability (no cron/batch jobs — all work is request-scoped).
- **Biggest forward risk:** the managed/anonymous access mode (S-5) shipping as the *default* posture for in-cluster installs, combined with an incomplete CHANGELOG (DOC-1) — an operator upgrading from a token-mode version may not realise the login screen disappeared.

---

## 1. Audit Tracking Table

IDs from the 2026-06-01 pass are preserved. New IDs this pass: S-5…S-8, DOM-1, B-2, R-1, INFRA-1, DOC-1…3, I-1…3.

| ID | Pass found | Severity | Area | Title | Status 2026-07-02 | Test covering fix? |
|---|---|---|---|---|---|---|
| S-1 | 2026-06-01 | HIGH | Security | Cross-user cache leak in token mode (RBAC bypass) | **FIXED** — `k8s/client.go:69` `cacheKey()` = sha256(token)[:8] + apiServer | `k8s/cache_test.go:11` |
| F-1 | 2026-06-01 | HIGH | Bug | Node-capacity capping of suggestions never runs | **FIXED** — `dashboard/page.tsx:176-178` pre-loads nodes in namespace view | no (manual) |
| S-2 | 2026-06-01 | MEDIUM | Security | Backend container runs as root | **FIXED** — `backend/Dockerfile:16` `USER 65534:65534` | n/a |
| S-3 | 2026-06-01 | MEDIUM | Supply chain | Docker base images not digest-pinned | **FIXED** — both Dockerfiles pinned `@sha256:…` (now golang:1.26-alpine, node:26-alpine) | n/a |
| S-4 | 2026-06-01 | LOW | Security | Session JWT minimal (no `iss`/`aud`/`nbf`, no refresh) | OPEN — `oidc/session.go:24-28` | — |
| F-2 | 2026-06-01 | LOW | Performance | No pagination/virtualisation for 100+ workloads | OPEN — `dashboard/page.tsx:549` | — |
| F-3 | 2026-06-01 | INFO | Observability | `/healthz` always 200, no real readiness probe | OPEN — `main.go:148` | — |
| Fa-1 | 2026-06-01 | INFO | Factorisation | `QueryRange`/`QueryRangeMulti` ~50 duplicated lines | OPEN — `prometheus/client.go:104-178` | — |
| Fa-2 | 2026-06-01 | INFO | Factorisation | JSON error boilerplate repeated in middleware | OPEN — `middleware/auth.go:24,31,81`, `session.go:22,29,54`, `cluster.go:32,45` | — |
| Fa-3 | 2026-06-01 | INFO | Factorisation | Pod→container→usage map built 3× | OPEN — `handlers/resources.go:115-125`, `handlers/nodes.go:191-199`, `resources/workloads.go:71-77` | — |
| Fa-4 | 2026-06-01 | INFO | Factorisation | "Increase-or-migrate" block repeated 3× | OPEN — `suggestions.ts:204-214,224-234,257-267` | — |
| Fa-5 | 2026-06-01 | INFO | Factorisation | Ratio→colour/label thresholds duplicated 3× | OPEN — `dashboard/page.tsx:432-446,456-461,514-519` | — |
| D-1 | 2026-06-01 | LOW | Dead code | `usagePct` exported but unused | **FIXED** — removed from `lib/api.ts` | n/a |
| D-2 | 2026-06-01 | LOW | Dead code | `docs/IMPROVE.md` stale v0.13 audit | **FIXED** — file deleted | n/a |
| D-3 | 2026-06-01 | LOW | Dead code | `GetPodMetrics` handler + route never called | **FIXED** — handler and route removed | n/a |
| M-1 | 2026-06-01 | LOW | Maintainability | `dashboard/page.tsx` god-component (589 lines) | OPEN — unchanged | — |
| M-2 | 2026-06-01 | LOW | Maintainability | Suggestion thresholds hard-coded/scattered | OPEN — `suggestions.ts` (0.90/0.70/0.35/3×/1.1/1.3/1.4/1.5) | — |
| T-1 | 2026-06-01 | MEDIUM | Testing | `k8s/client.go` retry/backoff/LimitReader untested | OPEN — no `httptest` coverage of networking path | — |
| T-2 | 2026-06-01 | MEDIUM | Testing | `k8s/cache.go` untested | **FIXED** — `k8s/cache_test.go` (key isolation, TTL expiry) | yes |
| T-3 | 2026-06-01 | LOW | Testing | `prometheus/client.go` untested | OPEN | — |
| T-4 | 2026-06-01 | LOW | Testing | Handlers orchestration untested | OPEN | — |
| T-5 | 2026-06-01 | LOW | Testing | Frontend components untested | OPEN (suggestions *lib* now has 36 tests; components still zero) | — |
| **S-5** | 2026-07-02 | **MEDIUM** | Security | Anonymous access is the default posture for in-cluster installs | **NEW** — `main.go:58-66,155` | — |
| **S-6** | 2026-07-02 | **MEDIUM** | Security | No HTTP server timeouts (slowloris) | ✅ FIXED 2026-07-25 — explicit `http.Server` in `main.go` | — |
| **DOM-1** | 2026-07-02 | **MEDIUM** | Domain correctness | `toKubectlCmd` targets `deployment/` for StatefulSet/CronJob workloads | **NEW** — `suggestions.ts:386` | — |
| **INFRA-1** | 2026-07-02 | **MEDIUM** | CI/CD | CI runs only on push to `main` — pull requests are unverified | **NEW** — `.github/workflows/ci.yml:3-5` | — |
| **S-7** | 2026-07-02 | LOW | Security | Default-cluster SA token silently sent to *other* clusters' API servers | **NEW** — `middleware/auth.go:64`, `middleware/session.go:41` | — |
| **S-8** | 2026-07-02 | LOW | Security | No request-body size cap on `POST /api/auth/session` | **NEW** — `handlers/oidc.go:89` | — |
| **B-2** | 2026-07-02 | LOW | Bug | Linear-regression trend on raw unix timestamps risks precision loss | **NEW** — `suggestions.ts:49-67` | — |
| **R-1** | 2026-07-02 | LOW | Robustness | Prometheus queries ignore request context (no cancellation) | **NEW** — `prometheus/client.go:114,153` | — |
| **DOC-1** | 2026-07-02 | LOW | Docs | CHANGELOG 0.26.0 missing this branch's security fixes | **NEW** — `CHANGELOG.md:7` | — |
| **DOC-2** | 2026-07-02 | LOW | Docs | Stale comments contradict token-fingerprint cache keys | **NEW** — `k8s/cache.go:13`, `k8s/client.go:219` | — |
| **DOC-3** | 2026-07-02 | LOW | Docs | CLAUDE.md Known Issues stale (fixed/moved items still listed) | **NEW** — `CLAUDE.md` Known Issues section | — |
| **I-1** | 2026-07-02 | INFO | Maintainability | Unnecessary mutex in `GetNamespaceHistory` (loops run after `g.Wait()`) | **NEW** — `prometheus/client.go:261-272` | — |
| **I-2** | 2026-07-02 | INFO | Maintainability | `ParseMemoryBytes` silently returns 0 on invalid input (CPU parser logs) | **NEW** — `resources/parse.go:43-69` | — |
| **I-3** | 2026-07-02 | INFO | Maintainability | Namespace not URL-encoded in `api.deployments`/`namespaceHistory` (inconsistent with `nodePods`) | **NEW** — `lib/api.ts:216,224` | — |

---

## 1.B Audit Coverage Matrix

| Path / area | Status |
|---|---|
| `backend/main.go`, `main_test.go` | reviewed 2026-07-02 |
| `backend/k8s/` (client, cache, cache_test, types) | reviewed 2026-07-02 |
| `backend/middleware/` (auth, session, session_test, cluster) | reviewed 2026-07-02 |
| `backend/oidc/` (session, session_test) | reviewed 2026-07-02 |
| `backend/handlers/` (all 7 + oidc_test) | reviewed 2026-07-02 |
| `backend/resources/` (parse, format, nodes, validate, workloads, types + tests) | reviewed 2026-07-02 |
| `backend/prometheus/client.go` | reviewed 2026-07-02 |
| `backend/Dockerfile`, `frontend/Dockerfile`, `docker-compose.yml`, `.env.example` | reviewed 2026-07-02 |
| `.github/workflows/` (ci.yml, docker-publish.yml) | reviewed 2026-07-02 |
| `frontend/src/app/` (page, dashboard, layout, auth/*, api/[...path]) | reviewed 2026-07-02 |
| `frontend/src/lib/` (api, suggestions + test, storage, status, clusterColor, version) | reviewed 2026-07-02 |
| `frontend/src/hooks/useSessionState.ts`, `frontend/src/proxy.ts` | reviewed 2026-07-02 |
| `frontend/src/components/` (NodeCard, SuggestionPanel deep; others skimmed for structure/size) | reviewed 2026-07-02 (light on CircleGauge, PodBar, PodRow, ResourceBar, Sidebar, Sparkline*, Topbar, VolumeSection, DeploymentCard) |
| CSS modules (`*.module.css`, `globals.css`) | skipped — cosmetic; known LOW items (focus-visible, type scale) tracked in CLAUDE.md backlog |
| `README.md`, `CHANGELOG.md`, `CLAUDE.md`, `ClaudeDone.md`, `ROADMAP.md`, `docs/*` | reviewed 2026-07-02 |
| Sibling repo `kubeadjust-helm` | skipped — not checked out alongside; seccomp/fsGroup/sizeLimit items live there |

**Coverage gaps the next pass must close:** deep-read the 9 skimmed components (especially `PodRow.tsx` and `SparklineModal.tsx`); audit the kubeadjust-helm chart if checked out (seccomp, fsGroup, emptyDir sizeLimit, helm lint in its CI).

---

## 2. New findings (2026-07-02) — detail

### Highlights since last pass

The 2026-06-01 pass's entire priority shortlist is closed: the cross-user cache leak (S-1) got exactly the recommended token-fingerprint fix plus a regression test; the backend image dropped root; both images are digest-pinned (and bumped to node:26 / checked against Renovate today); the dead `maxNodeCapacity` path now runs. Meanwhile v0.25/0.26 introduced managed-SA mode and kubectl export — each of which brings one new MEDIUM below.

### MEDIUM

**S-5 — Anonymous access is the default posture for in-cluster installs**
- `main.go:58-66` sets `hasInClusterDefault=true` whenever `/var/run/secrets/kubernetes.io/serviceaccount/token` exists — which is *every* Helm install (the chart mounts a cluster-read SA). `main.go:155` then flips `managedDefault=true` (no OIDC, no CLUSTERS), the login page shows "Enter dashboard" with no credential (`app/page.tsx:139`), and `ManagedAuth` injects the SA token for any request with no Authorization header (`middleware/auth.go:56-73`).
- Consequence: a default Helm install without OIDC serves cluster-wide pod/node/namespace metadata to **anyone who can reach the frontend** — a silent regression from the pre-v0.24 token-mode default. README line 38 sells this as a feature but never states the "no authentication at all" implication.
- Fix: (1) require an explicit opt-in (e.g. `ALLOW_ANONYMOUS=true` or `MANAGED_MODE=true`) before in-cluster auto-detection enables managed mode, or at minimum log a prominent startup `WARN: dashboard is accessible without authentication`; (2) document the implication in README and `docs/`; (3) recommend OIDC or network policy for any non-loopback exposure.

**S-6 — No HTTP server timeouts (slowloris)** — ✅ FIXED 2026-07-25
- `main.go:219` used `http.ListenAndServe`, whose zero-value server has no `ReadHeaderTimeout`, `ReadTimeout`, or `IdleTimeout`. A single actor holding headers open can exhaust connections; Chi's `Throttle(20)` doesn't help because throttling happens after the request is read.
- Fixed: `main.go` now builds an explicit `http.Server` with `ReadHeaderTimeout: 10s`, `ReadTimeout: 30s`, `WriteTimeout: 60s`, `IdleTimeout: 120s`. `WriteTimeout` is set above the frontend proxy's 30s ceiling so it bounds runaway handlers without cutting requests the dashboard is still waiting for.
- Verified: a raw connection sending partial headers and never terminating them is now closed by the server after exactly 10.0s; previously it stayed open indefinitely.

**DOM-1 — `toKubectlCmd` targets `deployment/` for StatefulSet and CronJob workloads**
- `suggestions.ts:386` hardcodes `kubectl set resources deployment/${s.deployment}`, but suggestions are computed for Deployments, StatefulSets **and** CronJobs (`handlers/resources.go:195-244`; `DeploymentDetail.kind` exists at `lib/api.ts:50` but is never propagated into `Suggestion`).
- Failure scenario: a StatefulSet named `postgres` gets a memory suggestion → the user copies `kubectl set resources deployment/postgres …` → either "not found" (confusing) or, if a same-named Deployment exists, **patches the wrong workload**. The panel's "export kubectl" bundle (`SuggestionPanel.tsx:244`) multiplies this. This is the product's output of record — held to the highest bar.
- Fix: add `kind` to `Suggestion` (from `dep.kind` in `computeSuggestions`), emit `statefulset/${name}` for StatefulSets, and return `null` for CronJobs (`kubectl set resources` cannot reach `spec.jobTemplate`). Add a unit test per kind in `suggestions.test.ts`.

**INFRA-1 — CI runs only on push to `main`; pull requests are unverified**
- `.github/workflows/ci.yml:3-5` is `on: push: branches: [main]`. Commit `1efc51d` deleted `docker-pr.yml` and the `pull_request` trigger, so feature-branch PRs now merge with zero build/test/lint verification, and the branch protection value of CI is gone. CLAUDE.md still claims "ci.yml runs on push/PR to `main`" (doc drift).
- Fix: restore `pull_request: branches: [main]` in `ci.yml` (the existing `github.actor != 'renovate[bot]'` guard still skips Renovate PRs).

### LOW

**S-7 — Default-cluster SA token silently sent to other clusters** — `middleware/auth.go:64` and `middleware/session.go:41` fall back to `saTokens["default"]` when the requested cluster has no token of its own. With `CLUSTERS=prod=…` configured but `SA_TOKEN_PROD` missing, the *default* cluster's credential is transmitted to the prod API server — cross-cluster credential disclosure on a misconfiguration that startup only WARNs about (`main.go:107-111`). Fix: only fall back to "default" when the target cluster *is* default; otherwise return 401 with the existing log hint.

**S-8 — Unbounded request body on `POST /api/auth/session`** — `handlers/oidc.go:89` decodes `r.Body` with no size cap, and the frontend proxy (`app/api/[...path]/route.ts:44`) streams bodies through. Wrap with `http.MaxBytesReader(w, r.Body, 64<<10)` before decoding.

**B-2 — Trend regression on raw unix timestamps** — `suggestions.ts:53-60` computes `denom = n*sumTT - sumT*sumT` with `t ≈ 1.7e9`; both terms are ~1e20 and the subtraction cancels ~11 of float64's ~16 significant digits. Results are currently acceptable (~5 digits survive) but one step from garbage. Fix: subtract `recent[0].t` from every `t` before the sums (one line, exact same slope).

**R-1 — Prometheus queries ignore request context** — `prometheus/client.go:114,153` use `httpClient.Get` with no `ctx`; a client that navigates away leaves the 30s query running. Fix: thread `ctx` from the handler and use `http.NewRequestWithContext` (pairs naturally with the Fa-1 dedup).

**DOC-1 — CHANGELOG 0.26.0 incomplete** — `CHANGELOG.md` for 0.26.0 (dated 2026-05-26) lists only the suggestion features; the branch also contains the S-1 security fix, non-root backend image, digest pinning, node preload fix, dead-code removals, and today's dependency bumps (Go deps, Next 16.2.10, node:26 images, checkout v7, cosign v4). Security fixes especially belong in the changelog before tagging.

**DOC-2 — Stale cache comments** — `k8s/cache.go:13` ("keyed by API server URL … not per-user") and `k8s/client.go:219` ("cached per cluster URL") both contradict the token-fingerprint `cacheKey()`; a future reader could "simplify" the key back into the S-1 vulnerability. Update both comments to reference `cacheKey()`.

**DOC-3 — CLAUDE.md Known Issues stale** — digest pinning listed though fixed; four items reference `helm/kubeadjust/templates/…` paths that no longer exist in this repo (chart moved); "N+1 kubelet calls" was resolved by the v0.22 TTL cache + `SetLimit(5)`; "runs on push/PR" claim contradicts ci.yml. Synced as part of this pass.

### INFO

- **I-1** — `prometheus/client.go:261-272`: `getOrCreate` takes a mutex, but both consuming loops run sequentially after `g.Wait()`; drop the mutex or move indexing inside the goroutines.
- **I-2** — `resources/parse.go:43-69`: `ParseMemoryBytes` ignores parse errors while `ParseCPUMillicores` logs them; align for the same observability rationale (v0.23 change log).
- **I-3** — `lib/api.ts:216,224`: namespace interpolated without `encodeURIComponent` while `nodePods`/history pod/container are encoded. Namespaces are DNS labels so not exploitable, but make it uniform.

### Carry-overs unchanged

S-4, F-2, F-3, Fa-1…Fa-5, M-1, M-2, T-1, T-3, T-4, T-5 — see tracking table; none regressed, none progressed except T-5 (suggestions *lib* now well-tested; components still zero).

### Positive notes

- `suggestions.test.ts` grew to 36 tests covering rounding, capping, coherence, and trend paths — the domain logic is no longer test-free.
- The S-1 fix is textbook: fingerprint key, doc comment explaining the threat, dedicated test asserting isolation, stability, and no raw-token leakage (`k8s/cache_test.go`).
- Renovate consolidation kept `go.sum` tidy and lockfile consistent; base images re-pinned by digest after the node:26 bump.

---

## 3. What's done right

- **Minimal dependency surface**: 5 Go deps (chi, cors, errgroup, go-oidc, oauth2), raw HTTP K8s client, no charting/UI libraries — the whole stack is auditable in a day.
- **Security fundamentals**: nonce-based CSP with `strict-dynamic` (`proxy.ts`), path-traversal rejection in the API proxy, PromQL label whitelist, 10 MB `LimitReader` on both upstream clients, generic client-facing errors with server-side logging, tokens never logged, OIDC state CSRF cookie (5 min, httpOnly), constant-time HMAC compare ignoring the JWT header (no alg-confusion), HTTPS-enforced redirect URL, throttled public OIDC endpoints, audit log on session creation.
- **Correctness care**: kubelet token rotation handled by per-request re-read (no stale-token 401s), NFS `statfs` heuristic for PVC stats, `KeepAlive: 30s` on custom transports (stale-connection fix), retry with backoff that fails fast on 4xx, errgroup with `SetLimit` bounding kubelet fan-out.
- **Comment discipline**: non-obvious decisions carry "why" comments (cache key threat model, StrictMode double-invocation guard, URL-param consumption semantics).
- **Test discipline where it counts**: pure calculation (parse/format/validate/workloads/nodes), session JWT, middleware auth matrix, suggestion engine — all covered; CI runs vet + golangci-lint + typecheck + build + lint.

---

# 4. Audit Checklist — applied every pass

### Security
- [x] Every data route behind auth middleware (`main.go:184-215`) — but see S-5 for the managed-mode anonymous posture
- [x] No string-built queries: PromQL inputs whitelisted (`resources/validate.go`), K8s paths escaped (`k8s/client.go:149`)
- [x] Secrets never logged — `grep -ri 'log.*token'` clean; audit log prints subject only (`handlers/oidc.go:138`)
- [x] Response size caps: 10 MB LimitReader on K8s + Prometheus clients
- [ ] Request body size caps on POST endpoints (S-8)
- [x] CORS configurable, warns on wildcard (`main.go:39`); `AllowCredentials: false`
- [x] CSP nonce-based, no `unsafe-*` in script-src (`proxy.ts`)
- [x] Session JWT: signature verified constant-time, header ignored (no alg confusion), expiry enforced (`oidc/session.go:52-77`)
- [x] HTTP server timeouts set (S-6 — `main.go`, verified against a slowloris connection)
- [x] OIDC: state CSRF check, HTTPS redirect enforced, group gate server-side, discovery timeout
- [ ] Managed mode requires explicit opt-in (S-5)
- [x] Cache keys isolate users in token mode (`k8s/cache_test.go`)

### Correctness & concurrency
- [x] errgroup everywhere with context propagation in handlers; `SetLimit` bounds kubelet calls (`handlers/resources.go:137`)
- [x] Best-effort sub-fetches log-and-continue instead of failing the request (statefulsets, metrics, PVCs)
- [x] 4xx vs 5xx distinguished in retry (`k8s/client.go:133`); 401 handled distinctly client-side (`lib/api.ts:124`)
- [ ] Prometheus queries honour request context (R-1)
- [x] In-cluster SA token re-read per request (kubelet rotation)
- [ ] kubectl output names the correct workload kind (DOM-1)
- [ ] Regression math numerically centred (B-2)

### Maintainability / DRY / dead code
- [x] Doc comments on all exported Go funcs; "why" comments present
- [ ] Fa-1…Fa-5 factorisation opportunities (carried; none has hit the "third caller" tipping point except Fa-3/Fa-5 which already have)
- [x] No orphaned files or ghost endpoints (D-1…D-3 closed; re-checked exports this pass)
- [ ] `dashboard/page.tsx` under 300 lines (M-1: 589)
- [ ] Suggestion thresholds in one config object (M-2)
- [ ] Comments match cache-key reality (DOC-2)

### Performance
- [x] Cluster-wide fetches cached 30s, kubelet summaries 60s (`k8s/cache.go`)
- [x] All-pods query filters Succeeded/Failed at the API (`k8s/client.go:226`)
- [ ] Large-cluster rendering: no virtualisation (F-2)

### Observability
- [x] Server-side logging on every error path with context
- [ ] `/healthz` reflects a real dependency (F-3)
- [x] Startup logs surface misconfiguration (missing SA tokens, wildcard CORS, insecure TLS)

### Testing
- [x] Pure-calculation packages covered; suggestion engine 36 tests; middleware auth matrix tested
- [ ] `k8s/client.go` networking path (T-1), prometheus parsing (T-3), handler orchestration (T-4), frontend components (T-5)
- [ ] CI runs on pull requests (INFRA-1)
- [ ] `go test -race` in CI (not enabled; caches are concurrent)

### Docs
- [ ] CHANGELOG complete for the release being cut (DOC-1)
- [ ] CLAUDE.md backlog matches reality (DOC-3 — synced this pass)
- [x] README features match shipped behaviour (managed mode listed; see S-5 for the missing caveat)
- [x] `.env.example` covers all env vars including OIDC/multi-cluster/SA tokens

### Supply chain
- [x] Base images digest-pinned, Renovate bumps digests
- [x] Images signed (cosign keyless), SBOM per image (anchore), multi-arch
- [x] No EOL runtimes (Go 1.26, Node 26, Next 16, React 19 — all current)
- [x] Renovate configured; consolidation workflow keeps `go.sum`/lockfile tidy

---

## 5. Verdict

**Ship-readiness: yes for trusted-network / OIDC deployments; fix S-5 messaging before promoting anonymous managed mode further.** Nothing here is release-blocking by the rubric (no HIGH/CRITICAL open), but S-5 + DOC-1 together create a realistic "operator surprise" scenario on upgrade, and DOM-1 degrades the product's core promise (copy-paste-safe suggestions).

**Top highest-leverage next moves**
1. **DOM-1** — propagate `kind` into `Suggestion` and fix `toKubectlCmd` (+3 unit tests). Small change, protects the flagship feature.
2. **INFRA-1** — restore the `pull_request` trigger in `ci.yml`. One line; re-arms the whole quality gate.
3. **S-5** — explicit opt-in (or loud warning) for anonymous managed mode, in `main.go`. (S-6, its neighbour in the same file, was fixed 2026-07-25.)
4. **DOC-1** — complete the 0.26.0 changelog before tagging (security fixes + dep bumps).

### Audit-pass progress summary

| Pass | Score | OPEN HIGH | OPEN MED | Closures in pass |
|---|---|---|---|---|
| 2026-06-01 | — | 2 | 3 | — |
| 2026-07-02 | 7.5/10 | 0 | 5 (S-5, S-6, DOM-1, INFRA-1, T-1) | 8 |
| _post-pass fixes 2026-07-25_ | — | 0 | 4 (S-5, DOM-1, INFRA-1, T-1) | S-6 + frontend probe/proxy hardening |
