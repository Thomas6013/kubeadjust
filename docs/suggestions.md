# KubeAdjust — Suggestion Rules Reference

All suggestion rules applied by `frontend/src/lib/suggestions.ts` and displayed in `SuggestionPanel.tsx`.

---

## Data Sources

| Source | When used | Precision |
|---|---|---|
| **Prometheus P95** | History available (≥2 data points) | Best — captures real spikes |
| **Prometheus Mean** | History available (≥2 data points) | Best — captures average usage |
| **Metrics-server snapshot** | No Prometheus or <2 points | Instant only — single point in time |

**Confidence indicator** (appended to message when Prometheus is used):
- `low confidence` — <60 data points (~1h at 60s step)
- `medium confidence` — 60–399 points (~6h)
- `high confidence` — 400+ points (~24h/7d)

---

## CPU / Memory Rules

### Rule 1 — DANGER: Near limit (≥90%)

| Field | Value |
|---|---|
| **Condition** | `P95 usage / limit ≥ 0.90` |
| **Kind** | `danger` |
| **Message** | `"CPU P95 usage at 95% of limit"` |
| **Action** | **Increase limit** |
| **Current** | Current limit value |
| **Suggested** | `P95 × 1.4` |
| **Why** | Container is about to hit OOMKill (memory) or CPU throttling. Need headroom. |

### Rule 2 — WARNING: Approaching limit (≥70%)

| Field | Value |
|---|---|
| **Condition** | `P95 usage / limit ≥ 0.70` (and <0.90) |
| **Kind** | `warning` |
| **Message** | `"CPU P95 usage at 75% of limit"` |
| **Action** | **Increase limit** |
| **Current** | Current limit value |
| **Suggested** | `P95 × 1.4` |
| **Why** | Getting close to limit. Proactive alert before it becomes critical. |

### Rule 3a — WARNING: No request defined

| Field | Value |
|---|---|
| **Condition** | `request == 0` (not set in pod spec), usage > 0 |
| **Kind** | `warning` |
| **Resource** | `"CPU — no request"` or `"Memory — no request"` |
| **Message** | `"No CPU request set — scheduler cannot guarantee resources"` |
| **Action** | **Set request** |
| **Current** | `"none"` |
| **Suggested** | `mean × 1.3` (or `snapshot × 1.3` if no Prometheus) |
| **Why** | Without a request, the scheduler can't guarantee resources. Pod may be evicted under pressure. |

### Rule 3b — WARNING: No limit defined

| Field | Value |
|---|---|
| **Condition** | `limit == 0` (not set in pod spec) |
| **Kind** | `warning` |
| **Resource** | `"CPU — no limit"` or `"Memory — no limit"` |
| **Message** | `"No CPU limit set — container can consume unbounded cpu"` |
| **Action** | **Set limit** |
| **Current** | `"unlimited"` |
| **Suggested** | `P95 × 1.5` (or `snapshot × 2` if no Prometheus) |
| **Why** | Without a limit, one container can starve others on the node. |

### Rule 4 — OVERKILL: Request over-provisioned (≤35% used)

| Field | Value |
|---|---|
| **Condition** | `mean usage / request ≤ 0.35` |
| **Kind** | `overkill` |
| **Message** | `"CPU avg request is 5.2× actual usage"` |
| **Action** | **Reduce request** |
| **Current** | Current request value |
| **Suggested** | `mean × 1.3` |
| **Why** | Request reserves resources on the node. Too high = wasted capacity, pods can't be scheduled. |

### Rule 5 — OVERKILL: Limit over-provisioned (≥3× P95)

| Field | Value |
|---|---|
| **Condition** | `limit / P95 usage ≥ 3` |
| **Kind** | `overkill` |
| **Message** | `"Memory limit is 4.2× P95 usage"` |
| **Action** | **Reduce limit** |
| **Current** | Current limit value |
| **Suggested** | `P95 × 1.5` |
| **Why** | Limit is way higher than actual peaks. Can be reduced to free node headroom. |

---

## Ephemeral Storage Rules

### Rule 6 — WARNING: No ephemeral-storage limit

| Field | Value |
|---|---|
| **Condition** | `ephemeralStorage.limit` not set, usage > 0 |
| **Kind** | `warning` |
| **Resource** | `"Ephemeral — no limit"` |
| **Action** | **Set limit** |
| **Current** | `"unlimited"` |
| **Suggested** | `usage × 2` |
| **Why** | Unbounded ephemeral can fill the node disk → pod eviction. |

### Rule 7 — DANGER: Ephemeral near limit (≥90%)

| Field | Value |
|---|---|
| **Condition** | `usage / limit ≥ 0.90` |
| **Kind** | `danger` |
| **Action** | **Increase limit** |
| **Current** | Current limit |
| **Suggested** | `usage × 1.5` |

### Rule 8 — WARNING: Ephemeral approaching limit (≥70%)

| Field | Value |
|---|---|
| **Condition** | `usage / limit ≥ 0.70` (and <0.90) |
| **Kind** | `warning` |
| **Action** | **Increase limit** |
| **Current** | Current limit |
| **Suggested** | `usage × 1.5` |

---

## Volume Rules

### Rule 9 — DANGER: PVC near capacity (≥90%)

| Field | Value |
|---|---|
| **Condition** | `usage / capacity ≥ 0.90` |
| **Kind** | `danger` |
| **Action** | **Expand PVC** |
| **Current** | Current capacity |
| **Suggested** | `capacity × 1.5` |

### Rule 10 — WARNING: PVC approaching capacity (≥75%)

| Field | Value |
|---|---|
| **Condition** | `usage / capacity ≥ 0.75` (and <0.90) |
| **Kind** | `warning` |
| **Action** | **Expand PVC** |
| **Current** | Current capacity |
| **Suggested** | `capacity × 1.5` |

### Rule 11 — WARNING: EmptyDir without sizeLimit

| Field | Value |
|---|---|
| **Condition** | `vol.type == "emptyDir"` and `sizeLimit` not set |
| **Kind** | `warning` |
| **Action** | **Set sizeLimit** |
| **Current** | `"unlimited"` |
| **Suggested** | `usage × 2` |
| **Why** | EmptyDir without sizeLimit shares the node's ephemeral pool. Can cause node eviction. |

---

## Resource Bar Color Rules (`resourceStatus`)

Used by `ResourceBar.tsx` for visual indicators:

| Color | Condition | Meaning |
|---|---|---|
| **Red (danger)** | `usage / limit ≥ 0.90` | Critical — near limit |
| **Orange (warning)** | `usage / limit ≥ 0.70` | Approaching limit |
| **Blue (overkill)** | `usage / request ≤ 0.35` | Over-provisioned |
| **Green (healthy)** | Everything else | Normal |
| **Grey (none)** | No usage data | Metrics unavailable |

## Storage Bar Color Rules (`storageStatus`)

| Color | Condition | Meaning |
|---|---|---|
| **Orange (warning)** | No limit set | Always flagged |
| **Red (danger)** | `usage / capacity ≥ 0.90` | Critical |
| **Orange (warning)** | `usage / capacity ≥ 0.75` | Approaching capacity |
| **Green (healthy)** | Everything else | Normal |

---

## Display in SuggestionPanel

Each suggestion has its own `action` field (set per-rule in `suggestions.ts`). `SuggestionPanel.tsx` renders `s.action` directly.

| Rule | Action label |
|---|---|
| Rule 1 (danger near limit) | `"Increase limit"` |
| Rule 2 (warning near limit) | `"Increase limit"` |
| Rule 3 (no limit) | `"Set limit"` |
| Rule 3b (no request) | `"Set request"` |
| Rule 4 (request overkill) | `"Reduce request"` |
| Rule 5 (limit overkill) | `"Reduce limit"` |
| Rule 6 (no ephemeral limit) | `"Set limit"` |
| Rule 7 (ephemeral danger) | `"Increase limit"` |
| Rule 8 (ephemeral warning) | `"Increase limit"` |
| Rule 9 (PVC danger) | `"Expand PVC"` |
| Rule 10 (PVC warning) | `"Expand PVC"` |
| Rule 11 (emptyDir no sizeLimit) | `"Set sizeLimit"` |
