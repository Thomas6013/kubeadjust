package middleware

import (
	"context"
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

// TokenFromContext retrieves the token stored by BearerToken middleware.
func TokenFromContext(ctx context.Context) string {
	v, _ := ctx.Value(TokenKey).(string)
	return v
}
