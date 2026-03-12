package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/devops-kubeadjust/backend/oidc"
)

var testSecret = []byte("test-session-secret-that-is-at-least-32-chars-long!!")

func TestExtractSessionToken(t *testing.T) {
	t.Run("from Bearer header", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/", nil)
		req.Header.Set("Authorization", "Bearer mytoken123")
		if got := extractSessionToken(req); got != "mytoken123" {
			t.Errorf("got %q, want %q", got, "mytoken123")
		}
	})

	t.Run("from cookie", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/", nil)
		req.AddCookie(&http.Cookie{Name: "kubeadjust-session", Value: "cookietoken"})
		if got := extractSessionToken(req); got != "cookietoken" {
			t.Errorf("got %q, want %q", got, "cookietoken")
		}
	})

	t.Run("header takes precedence over cookie", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/", nil)
		req.Header.Set("Authorization", "Bearer headertoken")
		req.AddCookie(&http.Cookie{Name: "kubeadjust-session", Value: "cookietoken"})
		if got := extractSessionToken(req); got != "headertoken" {
			t.Errorf("got %q, want %q", got, "headertoken")
		}
	})

	t.Run("empty when no token", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/", nil)
		if got := extractSessionToken(req); got != "" {
			t.Errorf("expected empty, got %q", got)
		}
	})

	t.Run("empty Bearer value is ignored", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/", nil)
		req.Header.Set("Authorization", "Bearer   ")
		if got := extractSessionToken(req); got != "" {
			t.Errorf("expected empty, got %q", got)
		}
	})
}

func TestSessionAuth(t *testing.T) {
	saTokens := map[string]string{
		"default": "sa-token-default",
		"prod":    "sa-token-prod",
	}

	// The inner handler writes the SA token it received into the response body.
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(TokenFromContext(r.Context())))
	})
	handler := SessionAuth(saTokens, testSecret)(inner)

	validToken, err := oidc.CreateSessionToken("user@example.com", testSecret, time.Hour)
	if err != nil {
		t.Fatalf("failed to create test token: %v", err)
	}
	expiredToken, _ := oidc.CreateSessionToken("user@example.com", testSecret, -time.Minute)

	t.Run("no token → 401", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/", nil)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("got %d, want 401", w.Code)
		}
	})

	t.Run("invalid token → 401", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/", nil)
		req.Header.Set("Authorization", "Bearer not.a.valid.token")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("got %d, want 401", w.Code)
		}
	})

	t.Run("expired token → 401", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/", nil)
		req.Header.Set("Authorization", "Bearer "+expiredToken)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("got %d, want 401", w.Code)
		}
	})

	t.Run("valid token, default cluster", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/", nil)
		req.Header.Set("Authorization", "Bearer "+validToken)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Errorf("got %d, want 200", w.Code)
		}
		if got := w.Body.String(); got != "sa-token-default" {
			t.Errorf("SA token = %q, want %q", got, "sa-token-default")
		}
	})

	t.Run("valid token, named cluster", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/", nil)
		req.Header.Set("Authorization", "Bearer "+validToken)
		req.Header.Set("X-Cluster", "prod")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Errorf("got %d, want 200", w.Code)
		}
		if got := w.Body.String(); got != "sa-token-prod" {
			t.Errorf("SA token = %q, want %q", got, "sa-token-prod")
		}
	})

	t.Run("unknown cluster falls back to default SA token", func(t *testing.T) {
		// In practice ClusterURL rejects unknown clusters before SessionAuth runs.
		// But when only saTokens["default"] exists (single-cluster), any X-Cluster value
		// should resolve via the fallback.
		req := httptest.NewRequest("GET", "/", nil)
		req.Header.Set("Authorization", "Bearer "+validToken)
		req.Header.Set("X-Cluster", "nonexistent")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Errorf("got %d, want 200 (fallback to default)", w.Code)
		}
		if got := w.Body.String(); got != "sa-token-default" {
			t.Errorf("SA token = %q, want %q", got, "sa-token-default")
		}
	})

	t.Run("unknown cluster, no default → 400", func(t *testing.T) {
		noDefault := map[string]string{"prod": "sa-token-prod"}
		h := SessionAuth(noDefault, testSecret)(inner)
		req := httptest.NewRequest("GET", "/", nil)
		req.Header.Set("Authorization", "Bearer "+validToken)
		req.Header.Set("X-Cluster", "nonexistent")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != http.StatusBadRequest {
			t.Errorf("got %d, want 400", w.Code)
		}
	})

	t.Run("json content-type on 401", func(t *testing.T) {
		req := httptest.NewRequest("GET", "/", nil)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if ct := w.Header().Get("Content-Type"); ct != "application/json" {
			t.Errorf("Content-Type = %q, want application/json", ct)
		}
	})
}
