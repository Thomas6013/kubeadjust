# OIDC / SSO Authentication

KubeAdjust supports optional OIDC authentication in addition to the default Service Account token flow.
When enabled, users log in via an external identity provider (Keycloak, Dex, Google, GitHub via Dex, etc.)
instead of pasting a token manually. Works on managed clusters (EKS, GKE, AKS) with no Kubernetes API server configuration required.

---

## How it works

```
Browser → /auth/login (Next.js)
        → OIDC provider (Keycloak, Dex, ...)
        → /auth/callback (Next.js) → backend /api/auth/session
        → /auth/done (stores session JWT in sessionStorage)
        → /dashboard
```

1. The browser navigates to `/auth/login`. Next.js fetches a fresh OIDC authorization URL from the backend, stores a CSRF state in an httpOnly cookie, and redirects to the provider.
2. After the user authenticates, the provider redirects to `/auth/callback?code=...&state=...`. Next.js validates the state, then calls the backend to exchange the code.
3. The backend validates the OIDC ID token (JWKS-verified via `coreos/go-oidc/v3`), issues a signed HS256 session JWT (8h TTL), and returns it to Next.js.
4. Next.js passes the session JWT to the browser via a short-lived (30s) readable cookie. The `/auth/done` client page moves it into `sessionStorage` and redirects to `/dashboard`.
5. All subsequent API calls include the session JWT as a Bearer token. The backend `SessionAuth` middleware validates it and substitutes the pre-configured Service Account token for the requested cluster.

**Authorization model:** all authenticated users share the same K8s permissions (those of the SA token). Per-user K8s RBAC is not preserved. This is acceptable for a read-only dashboard.

---

## Prerequisites

1. An OIDC provider with a registered client (`redirect_uri = https://<your-host>/auth/callback`).
2. For multi-cluster: a Service Account with read-only permissions in each remote cluster — use `helm/kubeadjust/deploy/viewer-serviceaccount.yaml`.
3. For single-cluster: no SA token configuration needed — the pod uses its own in-cluster SA token automatically.

---

## Keycloak configuration

1. Create a realm (e.g. `myrealm`).
2. Create a client:
   - **Client ID:** `kubeadjust`
   - **Client authentication:** ON (confidential)
   - **Valid redirect URIs:** `https://kubeadjust.example.com/auth/callback`
   - **Web origins:** `https://kubeadjust.example.com`
3. Copy the **Client Secret** from the Credentials tab.
4. The issuer URL is: `https://keycloak.example.com/realms/myrealm`

---

## Helm installation

### Single-cluster (recommended — no SA token config needed)

```bash
SESSION_SECRET=$(openssl rand -hex 32)

helm upgrade --install kubeadjust ./helm/kubeadjust \
  --namespace kubeadjust --create-namespace \
  --set ingress.enabled=true \
  --set ingress.host=kubeadjust.example.com \
  --set oidc.enabled=true \
  --set oidc.issuerUrl=https://keycloak.example.com/realms/myrealm \
  --set oidc.clientId=kubeadjust \
  --set oidc.clientSecret=<keycloak-client-secret> \
  --set oidc.redirectUrl=https://kubeadjust.example.com/auth/callback \
  --set oidc.sessionSecret=$SESSION_SECRET
```

The pod uses its own mounted Service Account token to call the Kubernetes API — no `saToken` needed.

### Using an existing secret (recommended for production)

Create the secrets once (or via Sealed Secrets / External Secrets Operator):

```bash
kubectl create secret generic kubeadjust-oidc \
  --from-literal=clientSecret=<keycloak-client-secret> \
  --from-literal=sessionSecret=$(openssl rand -hex 32) \
  -n kubeadjust
```

Then reference it in values:

```yaml
oidc:
  enabled: true
  issuerUrl: "https://keycloak.example.com/realms/myrealm"
  clientId: "kubeadjust"
  redirectUrl: "https://kubeadjust.example.com/auth/callback"
  existingSecret: "kubeadjust-oidc"
```

---

## Multi-cluster OIDC

For multi-cluster deployments, configure clusters as a map and provide one SA token per remote cluster.

### values.yaml

```yaml
backend:
  clusters:
    prod: "https://k8s.prod.example.com:6443"
    staging: "https://k8s.staging.example.com:6443"

oidc:
  enabled: true
  issuerUrl: "https://keycloak.example.com/realms/myrealm"
  clientId: "kubeadjust"
  redirectUrl: "https://kubeadjust.example.com/auth/callback"
  existingSecret: "kubeadjust-oidc"
  existingTokenSecret: "kubeadjust-oidc-tokens"
```

### SA tokens secret

```yaml
# kubectl apply -f this file
apiVersion: v1
kind: Secret
metadata:
  name: kubeadjust-oidc-tokens
  namespace: kubeadjust
type: Opaque
stringData:
  prod: "eyJhbG..."      # SA token for the prod cluster
  staging: "eyJhbG..."   # SA token for the staging cluster
  # No "default" key needed — the local cluster uses the pod's in-cluster token
```

Secret key names must match the keys in `backend.clusters`. The default (local) cluster always uses the pod's in-cluster SA token automatically.

Get a long-lived SA token for a remote cluster:

```bash
# Using a Secret-based token (long-lived)
kubectl get secret kubeadjust-viewer-token -n kubeadjust \
  --context=prod-cluster \
  -o jsonpath='{.data.token}' | base64 -d

# Or using a projected token (recommended, 1 year)
kubectl create token kubeadjust-viewer -n kubeadjust \
  --context=prod-cluster \
  --duration=8760h
```

---

## Environment variables reference

| Variable | Required | Description |
|---|---|---|
| `OIDC_ENABLED` | — | Set to `true` to enable OIDC mode |
| `OIDC_ISSUER_URL` | Yes | Provider issuer URL (discovery doc at `{issuer}/.well-known/openid-configuration`) |
| `OIDC_CLIENT_ID` | Yes | OIDC client ID |
| `OIDC_CLIENT_SECRET` | Yes | OIDC client secret — keep in a K8s Secret |
| `OIDC_REDIRECT_URL` | Yes | Must exactly match the redirect URI registered in the provider |
| `SESSION_SECRET` | Yes | ≥32-char random string for signing session JWTs — keep in a K8s Secret |
| `SA_TOKEN` | No | SA token override for the default cluster (normally not needed — uses in-cluster token) |
| `SA_TOKEN_<CLUSTER>` | No | SA token for a named cluster, e.g. `SA_TOKEN_PROD` for cluster `prod` (Helm-generated) |
| `SA_TOKENS` | No | Legacy: `prod=token1,staging=token2` (still supported) |

---

## Session lifetime

Session JWTs have an 8-hour TTL. After expiry, the next API call returns 401 and the user is redirected to the login page. If the OIDC provider still has a valid session (Keycloak SSO), re-authentication is instant (no password prompt).

---

## Security notes

- The OIDC client secret and session secret are never exposed to the browser.
- The session JWT is stored in `sessionStorage` (cleared on tab close), same as the K8s token in default mode.
- The CSRF state is validated via an httpOnly `oidc-state` cookie (5-minute TTL).
- The token transfer from server to client uses a short-lived (30s) cookie scoped to `Path=/auth/done`.
- Logging out (`/auth/logout`) clears all `kube-token*` keys from sessionStorage.
- The frontend auth routes read `x-forwarded-proto` / `x-forwarded-host` headers to construct redirect URLs correctly behind an ingress or reverse proxy.
