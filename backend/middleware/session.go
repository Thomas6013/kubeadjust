package middleware

import (
	"context"
	"log"
	"net/http"
	"strings"

	"github.com/devops-kubeadjust/backend/oidc"
)

// SessionAuth validates a KubeAdjust session JWT and injects the pre-configured
// Service Account token for the requested cluster into the request context.
// The cluster is identified by the X-Cluster request header (or "default" for single-cluster).
// Accepts the session token either as a Bearer token or as a cookie (kubeadjust-session).
func SessionAuth(saTokens map[string]string, secret []byte) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			sessionToken := extractSessionToken(r)
			if sessionToken == "" {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":"authentication required"}`))
				return
			}

			if _, err := oidc.VerifySessionToken(sessionToken, secret); err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":"authentication required"}`))
				return
			}

			clusterName := r.Header.Get("X-Cluster")
			if clusterName == "" {
				clusterName = "default"
			}
			saToken, ok := saTokens[clusterName]
			if !ok {
				log.Printf("OIDC: SA token not configured for cluster %q — check SA_TOKEN_%s env var", clusterName, strings.ToUpper(strings.ReplaceAll(clusterName, "-", "_")))
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"unknown cluster"}`))
				return
			}

			ctx := context.WithValue(r.Context(), TokenKey, saToken)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func extractSessionToken(r *http.Request) string {
	// Prefer Bearer header (forwarded by Next.js proxy from sessionStorage)
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		if t := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer ")); t != "" {
			return t
		}
	}
	// Fallback: httpOnly cookie (future use / direct access)
	if cookie, err := r.Cookie("kubeadjust-session"); err == nil && cookie.Value != "" {
		return cookie.Value
	}
	return ""
}
