package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestAuthConfig(t *testing.T) {
	for _, tt := range []struct {
		name        string
		oidcEnabled bool
	}{
		{"oidc disabled", false},
		{"oidc enabled", true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/api/auth/config", nil)
			w := httptest.NewRecorder()
			AuthConfig(tt.oidcEnabled)(w, req)

			if w.Code != 200 {
				t.Errorf("got %d, want 200", w.Code)
			}
			if ct := w.Header().Get("Content-Type"); ct != "application/json" {
				t.Errorf("Content-Type = %q, want application/json", ct)
			}

			var got map[string]bool
			if err := json.NewDecoder(w.Body).Decode(&got); err != nil {
				t.Fatalf("decode error: %v", err)
			}
			if got["oidcEnabled"] != tt.oidcEnabled {
				t.Errorf("oidcEnabled = %v, want %v", got["oidcEnabled"], tt.oidcEnabled)
			}
		})
	}
}
