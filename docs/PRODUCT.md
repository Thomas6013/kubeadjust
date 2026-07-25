# KubeAdjust — Product Analysis

> Analysis pass: **2026-07-25** (code state: `feature/0.26.0`)
> Scope: product strategy and retention, not code quality. For security/correctness findings see [AUDIT.md](AUDIT.md); for the shipping backlog see [../CLAUDE.md](../CLAUDE.md).

---

## Status

| Phase | Theme | Status |
|---|---|---|
| **1** | **Credibility** — suggestions you can trust | ✅ **Shipped in 0.26.0** |
| 2 | Money — cost as the unit of measure | Not started |
| 3 | Memory — the tool remembers what you forget | Not started |
| 4 | Push — the tool comes to you | Not started |
| 5 | Closed loop — from suggestion to PR | Not started |

---

## 1. Diagnostic

**KubeAdjust is a one-shot tool, and that is a design problem, not a feature gap.**

The real user journey today:

1. Install, open, discover `payments` requests 2Gi and uses 180Mi. Genuine "wow" moment.
2. Fix the 5–10 worst workloads over the following week.
3. **No remaining reason to open the dashboard.** Clusters do not de-optimise fast enough to justify a weekly visit.

`sessionStorage` is the perfect symptom: **when the tab closes, the tool forgets everything it knew about you.** A product with no memory cannot become indispensable — it offers nothing the user could not reproduce by hand with `kubectl top`.

The three levers of dependency in infrastructure tooling, in order:

| Lever | Before phase 1 | After phase 1 |
|---|---|---|
| **Trust** — advice that never causes an incident | ❌ OOM-blind, replica-duplicated | ✅ shipped |
| **Memory** — the tool knows what the human forgot | ❌ zero persistence | ❌ phase 3 |
| **Push** — the tool comes to you | ❌ 100 % pull | ❌ phase 4 |
| **Money** — a number management asks for | ❌ millicores only | ❌ phase 2 |

Trust was sequenced first deliberately: every later phase amplifies whatever the suggestion engine emits. Amplifying noise is worse than staying quiet.

---

## 2. Phase 1 — Credibility ✅ *(shipped in 0.26.0)*

One wrong suggestion costs more than ten missing ones. An SRE who follows advice and causes an OOM in production never reopens the tool. Five defects of that class were found and fixed.

### 2.1 Replica duplication — the panel was unusable at scale

`computeSuggestions` iterated `deployment → pod → container`, so a Deployment with 20 replicas emitted **20 identical suggestions** (only `pod` differed), and `SuggestionPanel` deduplicated nowhere.

The unit of analysis was simply wrong: requests are set on the **pod template**, never on a pod. On a namespace with 30 deployments × 10 replicas the panel showed hundreds of redundant rows — precisely where the tool should have been most useful.

**Fixed:** suggestions aggregate by `(workload, container, resource)`. Usage is pooled across every replica before computing P95/mean/peak; the row carries `podCount`. PVCs deliberately stay per-replica (a StatefulSet's `volumeClaimTemplates` create distinct physical volumes), emptyDirs deduplicate by name.

**Bonus signal:** replicas whose mean usage diverges by ≥2× now raise a "replica usage varies N×" warning — uneven load balancing is worth knowing about on its own.

### 2.2 OOMKills were invisible

Nothing in the backend read `OOMKilled` or `restartCount`, although `containerStatuses[].lastState.terminated.reason` was already in the pod payload being parsed.

Consequence: the `limit / p95Use >= 3` rule could recommend **cutting the memory limit of a container OOMKilled twice that night** — a killed container restarts with a low RSS, which drags the P95 down. Not merely wrong: actively dangerous.

**Fixed:** `RestartCount` and `OOMKilled` are exposed per container, `qosClass` per pod. When any replica was OOMKilled, memory reductions are suppressed and a `danger` is raised instead — "Increase limit" when a limit exists, "Set limit" (node-level OOM) when it does not.

### 2.3 Crashlooping containers produced confident nonsense

A container restarting every 30s reports usage that means nothing. **Fixed:** at ≥3 restarts, all reductions are suppressed for that container. Restart counts are surfaced as a warning on remaining suggestions.

### 2.4 Startup bursts were averaged away

P95 over 7 days flattens the startup spike completely. A JVM needing 2 CPU for 60s then 100m was told to request ~130m — the liveness probe fails at the next rolling update and the workload crashloops.

**Fixed:** when `peak / P95 ≥ 5`, the workload is treated as bursty and every reduction is sized on the **observed peak**, not the mean. Suggestions saving less than 10% against the peak are dropped entirely. The message carries `· bursty (peak N× P95)`.

This is deliberately conservative: a dropped suggestion costs nothing, an under-sized one causes an incident.

### 2.5 QoS class was never mentioned

Moving from `requests == limits` (Guaranteed) to `requests < limits` (Burstable) changes the pod's **eviction priority**. Reduction suggestions performed that downgrade silently — an incident waiting on a critical workload.

**Fixed:** for containers where `request == limit`, suggestions move **both sides together** (`Reduce request + limit`) so the pod keeps its class, and `toKubectlCmd` emits `--requests` and `--limits` in one command. A warning explains why. Guaranteed pairs emit a single reduction instead of two contradicting ones.

### 2.6 DOM-1 — kubectl targeted the wrong object

`toKubectlCmd` hardcoded `deployment/`, so copied commands for StatefulSets hit the wrong object or nothing at all.

**Fixed:** the workload kind is propagated into `Suggestion` and mapped to `deployment/`, `statefulset/`, `daemonset/`. CronJobs return `null` — `kubectl set resources` cannot reach a pod template nested under `spec.jobTemplate`, and offering no command beats offering a broken one.

*(Also closed in passing: AUDIT B-2 — the linear-regression trend now re-bases timestamps on the first sample instead of regressing raw unix seconds, whose squares lost float64 precision and skewed the slope.)*

---

## 3. Phase 2 — Money

**Nobody gets budget for millicores.** "This namespace wastes €340/month" changes what the product *is*: from an SRE gadget to a FinOps tool management asks for.

Every input already exists:

- `NodeOverview.capacity` / `allocatable` (`resources/types.go`)
- per-pod requests (`handlers/resources.go`)
- missing only the **instance type** (`node.kubernetes.io/instance-type`, present on every cloud node) plus a price table.

**Honest formula:** `workload_cost = (requests / node_allocatable) × node_hourly_price`, with waste being the same formula applied to `requests − P95`.

No cloud billing API needed. Two env vars (`COST_PER_VCPU_HOUR`, `COST_PER_GIB_HOUR`) with per-provider defaults are enough for a v1 — and **more defensible** than a pseudo-exact figure pulled from a billing API that nobody can reconcile.

**Deliverables:** cost per workload / namespace / cluster; a single "potential savings" figure at the top of the dashboard; cost attached to every overkill suggestion.

---

## 4. Phase 3 — Memory

Today the maximum horizon is the Prometheus `timeRange` (1h→7d), discarded on every reload. Consequences:

- Cannot say *"you saved 1.2 vCPU and 14 GiB this month"* — the one number that justifies the tool's existence to a manager.
- Cannot detect **regression**: a developer restoring `2Gi` in a Helm chart goes completely unnoticed.
- Cannot provide a **baseline**: *"this workload used 200Mi 30 days ago, it uses 900Mi now"* — that is memory-leak detection, and it is worth far more than a P95.

### The "no database" tension

The constraint is real but soluble, and the project has somewhat trapped itself on it. Three options by increasing cost:

1. **Prometheus as long memory** (cost ≈ 0) — already integrated. `quantile_over_time(0.95, ...[30d])` instead of 7d windows, plus recording rules shipped in the chart. Solves baseline + regression with zero storage. **Do this first.**
2. **ConfigMap as user state** (low cost) — dismissals, owners, custom thresholds, snapshots. Idiomatic Kubernetes, keeps "no database" true.
   ⚠️ Requires a **namespaced** `Role` with write on *one* ConfigMap in KubeAdjust's own namespace. This does **not** violate "the ClusterRole stays strictly read-only" — the ClusterRole is untouched — but it is an explicit decision to take and document.
3. **Optional SQLite** (medium cost) — only if daily snapshots over 12 months are wanted. Opt-in, off by default.

The moment a user can *dismiss* a suggestion, the tool stops being a viewer and becomes **their** tool.

---

## 5. Phase 4 — Push

Everything is pull. **No mechanism exists** to bring the user back. By ROI:

- **Weekly digest** (Slack/Teams/email): *"3 new wastes detected · 2 workloads at OOM risk · €380/month recoverable"*, deep-linking to `/dashboard?cluster=prod&ns=payments`. The shareable URLs already exist — they are useless without something that sends them. **Best effort/impact ratio in this whole document.**
- **PR comment** (GitHub/GitLab): a CLI binary running in CI posting *"this deployment requests 4× what the current version uses in production"*. The strongest dependency vector there is: the tool becomes **blocking in the workflow**, not optional beside it.
- **Regression alert**: someone degraded a workload you had optimised → immediate notification.

The weekly digest alone would transform retention.

---

## 6. Phase 5 — Closed loop

`toKubectlCmd` produces an imperative command. In real life it is **overwritten at the next ArgoCD/Flux sync** — the user is handed a gesture that will be silently undone.

What to produce instead, by increasing value:

1. **YAML patch** pasteable into the GitOps repo (zero extra permission — it is text).
2. **Helm `values.yaml` diff** — the format 90 % of teams actually use.
3. **Automatic PR** to the GitOps repo.
   ⚠️ This writes to **git**, not to the cluster: the "read-only on the cluster" promise stays intact. This is where the tool becomes irreplaceable — it stops advising and starts delivering.

### Split the panel by intent

Reducing a request is reversible and low-risk; raising a memory limit prevents an incident. Treating both as undifferentiated "suggestions" dilutes the signal. Two views — **Risk** and **Waste** — speak to two personas (SRE vs FinOps), which is how the product enters two workflows instead of one.

---

## 7. Anti-goals

- **Dark mode** (ROADMAP) — zero impact on value. Last, not first.
- **VPA integration** (ROADMAP) — if VPA is installed the user has already solved this problem; the integration would compete with it rather than complement it.
- **More views.** The risk is not missing information, it is noise. `dashboard/page.tsx` is already 588 lines for 3 views.
- **Breaking "no client-go / no CSS framework / read-only cluster".** These constraints are a genuine asset (5 Go runtime deps, audit 7.5/10). Nothing in this document requires breaking them — the single decision to take is the namespaced `Role` for the state ConfigMap in phase 3, and it is optional.

---

## 8. One-line summary

The product answers *"what is mis-sized right now?"* very well. Dependency is built on *"what changed, what does it cost me, and who has to fix it?"*
