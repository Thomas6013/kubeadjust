package middleware

import (
	"context"
	"log"
	"net/http"
	"strings"
)

type contextKey string

const TokenKey contextKey = "kube-token"

// BearerToken extracts the Authorization header and stores the token in context.
func BearerToken(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if auth == "" || !strings.HasPrefix(auth, "Bearer ") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"missing bearer token"}`))
			return
		}
		token := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
		if token == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"missing bearer token"}`))
			return
		}
		ctx := context.WithValue(r.Context(), TokenKey, token)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// ManagedAuth handles clusters with backend-side SA tokens.
// If the request carries a bearer token, it is used as-is (user-supplied token mode).
// If no bearer token is present, the middleware looks up the SA token for the target
// cluster (from X-Cluster header, falling back to "default") and injects it.
// Returns 401 if neither a user token nor a matching SA token is available.
func ManagedAuth(saTokens map[string]string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var token string

			auth := r.Header.Get("Authorization")
			if auth != "" && strings.HasPrefix(auth, "Bearer ") {
				token = strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
			}

			if token == "" {
				// No user-provided token — look up the SA token for this cluster.
				clusterName := r.Header.Get("X-Cluster")
				if clusterName == "" {
					clusterName = "default"
				}
				if t, ok := saTokens[clusterName]; ok {
					token = t
				} else if t, ok := saTokens["default"]; ok {
					token = t
				} else {
					log.Printf("ManagedAuth: no SA token for cluster %q and no default — set SA_TOKEN_%s or SA_TOKEN env var",
						clusterName, strings.ToUpper(strings.ReplaceAll(clusterName, "-", "_")))
				}
			}

			if token == "" {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":"missing bearer token"}`))
				return
			}

			ctx := context.WithValue(r.Context(), TokenKey, token)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// TokenFromContext retrieves the token stored by BearerToken middleware.
func TokenFromContext(ctx context.Context) string {
	v, _ := ctx.Value(TokenKey).(string)
	return v
}
