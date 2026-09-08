# Security Policy

## Supported versions

Only the latest release receives security fixes. The Helm chart carries the same version
number as the application, so there is one line to support, not two.

| Version | Supported |
|---|---|
| latest | Yes |
| older | No |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report them privately via [GitHub Security Advisories](https://github.com/Thomas6013/kubeadjust/security/advisories/new).

Include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- A suggested fix if you have one

You can expect an acknowledgement within 72 hours and a fix or mitigation plan within 14 days.

This is a solo side project; those are targets, not a contractual SLA.

## Security model

KubeAdjust is **read-only** and **stateless**:

- The backend has no database, no cache, and no persistent state
- The user's service account token is stored in `sessionStorage` only (cleared on tab close)
- The token is forwarded as-is to the Kubernetes API — Kubernetes RBAC enforces all permissions
- The backend never logs tokens or credentials
- All Kubernetes API access requires a valid Bearer token supplied by the user

## What the Helm chart enforces

The chart in [`charts/kubeadjust/`](charts/kubeadjust) is read-only by construction.

### RBAC — strictly read-only

The `ClusterRole` uses **only** `get`, `list` and `watch`. No `create`, `update`, `patch` or
`delete` is granted — ever. The role is fixed, with no value to widen it:

```yaml
verbs: ["get", "list", "watch"]
```

### Pod security hardening

Both the backend and frontend pods enforce:

| Setting | Value |
|---|---|
| `readOnlyRootFilesystem` | `true` |
| `runAsNonRoot` | `true` |
| `allowPrivilegeEscalation` | `false` |
| `capabilities.drop` | `["ALL"]` |

### NetworkPolicy

An optional `NetworkPolicy` (`networkPolicy.enabled=true`) restricts ingress and egress to
what the app needs. It requires a CNI that actually enforces NetworkPolicy.

### Secrets management

OIDC credentials (`clientSecret`, `sessionSecret`) and Service Account tokens belong in
Kubernetes `Secret` objects, referenced via `oidc.existingSecret` and
`oidc.existingTokenSecret` — not inlined into `values.yaml`. See [`deploy/`](deploy) for
example manifests.

### Known exception

On an in-cluster install without OIDC, the auto-mounted Service Account token enables
managed mode: anyone who can reach the frontend gets cluster-wide read access with no
login. Put the Ingress behind authentication, or enable OIDC, if that is not what you want.
