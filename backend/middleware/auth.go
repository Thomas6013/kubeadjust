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
			http.Error(w, `{"error":"missing bearer token"}`, http.StatusUnauthorized)
			return
		}
		token := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
		ctx := context.WithValue(r.Context(), TokenKey, token)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// TokenFromContext retrieves the token stored by BearerToken middleware.
func TokenFromContext(ctx context.Context) string {
	v, _ := ctx.Value(TokenKey).(string)
	return v
}
