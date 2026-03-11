package oidc

import (
	"strings"
	"testing"
	"time"
)

var testSecret = []byte("test-session-secret-that-is-at-least-32-chars-long!!")

func TestCreateAndVerifySessionToken(t *testing.T) {
	t.Run("valid token round-trip", func(t *testing.T) {
		token, err := CreateSessionToken("user@example.com", testSecret, time.Hour)
		if err != nil {
			t.Fatalf("CreateSessionToken error: %v", err)
		}
		if token == "" {
			t.Fatal("empty token")
		}
		if len(strings.Split(token, ".")) != 3 {
			t.Errorf("expected 3 JWT parts, got %q", token)
		}

		sub, err := VerifySessionToken(token, testSecret)
		if err != nil {
			t.Fatalf("VerifySessionToken error: %v", err)
		}
		if sub != "user@example.com" {
			t.Errorf("subject = %q, want %q", sub, "user@example.com")
		}
	})

	t.Run("expired token", func(t *testing.T) {
		token, err := CreateSessionToken("user", testSecret, -time.Minute)
		if err != nil {
			t.Fatalf("CreateSessionToken error: %v", err)
		}
		_, err = VerifySessionToken(token, testSecret)
		if err != ErrTokenExpired {
			t.Errorf("expected ErrTokenExpired, got %v", err)
		}
	})

	t.Run("wrong secret", func(t *testing.T) {
		token, _ := CreateSessionToken("user", testSecret, time.Hour)
		_, err := VerifySessionToken(token, []byte("different-secret-at-least-32-chars-long!!"))
		if err != ErrInvalidToken {
			t.Errorf("expected ErrInvalidToken, got %v", err)
		}
	})

	t.Run("tampered payload", func(t *testing.T) {
		token, _ := CreateSessionToken("user", testSecret, time.Hour)
		parts := strings.Split(token, ".")
		parts[1] += "X" // corrupt the claims
		_, err := VerifySessionToken(strings.Join(parts, "."), testSecret)
		if err != ErrInvalidToken {
			t.Errorf("expected ErrInvalidToken, got %v", err)
		}
	})

	t.Run("tampered header", func(t *testing.T) {
		token, _ := CreateSessionToken("user", testSecret, time.Hour)
		parts := strings.Split(token, ".")
		parts[0] += "X" // corrupt the header
		_, err := VerifySessionToken(strings.Join(parts, "."), testSecret)
		if err != ErrInvalidToken {
			t.Errorf("expected ErrInvalidToken, got %v", err)
		}
	})

	t.Run("malformed tokens", func(t *testing.T) {
		for _, bad := range []string{"", "only-one", "two.parts", "a.b.c.d"} {
			_, err := VerifySessionToken(bad, testSecret)
			if err != ErrInvalidToken {
				t.Errorf("VerifySessionToken(%q): expected ErrInvalidToken, got %v", bad, err)
			}
		}
	})

	t.Run("empty subject preserved", func(t *testing.T) {
		token, _ := CreateSessionToken("", testSecret, time.Hour)
		sub, err := VerifySessionToken(token, testSecret)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if sub != "" {
			t.Errorf("expected empty subject, got %q", sub)
		}
	})
}

func TestGenerateState(t *testing.T) {
	s1, err := GenerateState()
	if err != nil {
		t.Fatalf("GenerateState error: %v", err)
	}
	if len(s1) < 32 {
		t.Errorf("state too short: %q (len=%d)", s1, len(s1))
	}

	s2, err := GenerateState()
	if err != nil {
		t.Fatalf("GenerateState error: %v", err)
	}
	if s1 == s2 {
		t.Error("two consecutive states should not be equal")
	}
}
