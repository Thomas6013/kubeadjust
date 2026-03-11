package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestHasRequiredGroup(t *testing.T) {
	tests := []struct {
		name           string
		userGroups     []string
		requiredGroups []string
		want           bool
	}{
		{
			"user is in required group",
			[]string{"kubeadjust-users", "devs"},
			[]string{"kubeadjust-users"},
			true,
		},
		{
			"user matches one of multiple required groups",
			[]string{"devs"},
			[]string{"kubeadjust-users", "devs"},
			true,
		},
		{
			"user not in any required group",
			[]string{"other-team"},
			[]string{"kubeadjust-users"},
			false,
		},
		{
			"user has no groups",
			[]string{},
			[]string{"kubeadjust-users"},
			false,
		},
		{
			"partial name does not match",
			[]string{"kubeadjust"},
			[]string{"kubeadjust-users"},
			false,
		},
		{
			"no required groups returns false (caller must guard)",
			[]string{"devs"},
			[]string{},
			false,
		},
		{
			"case-sensitive: lowercase ≠ uppercase",
			[]string{"KubeAdjust-Users"},
			[]string{"kubeadjust-users"},
			false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := hasRequiredGroup(tt.userGroups, tt.requiredGroups)
			if got != tt.want {
				t.Errorf("hasRequiredGroup(%v, %v) = %v, want %v", tt.userGroups, tt.requiredGroups, got, tt.want)
			}
		})
	}
}

func TestAuthConfig(t *testing.T) {
	for _, tt := range []struct {
		name           string
		oidcEnabled    bool
		managedDefault bool
	}{
		{"oidc disabled, not managed", false, false},
		{"oidc enabled, not managed", true, false},
		{"oidc disabled, managed default", false, true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/api/auth/config", nil)
			w := httptest.NewRecorder()
			AuthConfig(tt.oidcEnabled, tt.managedDefault)(w, req)

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
			if got["managedDefault"] != tt.managedDefault {
				t.Errorf("managedDefault = %v, want %v", got["managedDefault"], tt.managedDefault)
			}
		})
	}
}
