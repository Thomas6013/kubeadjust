# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.2.x   | Yes       |
| 0.1.x   | No        |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report them privately via [GitHub Security Advisories](https://github.com/thomas6013/devops-kubeadjust/security/advisories/new).

Include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- A suggested fix if you have one

You can expect an acknowledgement within 72 hours and a fix or mitigation plan within 14 days.

## Security model

KubeAdjust is **read-only** and **stateless**:

- The backend has no database, no cache, and no persistent state
- The user's service account token is stored in `sessionStorage` only (cleared on tab close)
- The token is forwarded as-is to the Kubernetes API — Kubernetes RBAC enforces all permissions
- The backend never logs tokens or credentials
- All Kubernetes API access requires a valid Bearer token supplied by the user

The Helm chart deploys with minimal RBAC (read-only ClusterRole) and a hardened container security context (`readOnlyRootFilesystem`, `runAsNonRoot`, `allowPrivilegeEscalation: false`, all capabilities dropped).
