package k8s

import (
	"strings"
	"testing"
	"time"
)

// cacheKey must isolate cached cluster-wide data per token, so that in token mode
// a restricted user is never served data fetched by a more privileged user (S-1).
func TestCacheKey_IsolatesByToken(t *testing.T) {
	const server = "https://api.example.svc"

	a := New("token-A", server).cacheKey()
	b := New("token-B", server).cacheKey()
	if a == b {
		t.Fatalf("different tokens must produce different cache keys, both = %q", a)
	}

	// Same token + same server must be stable (cache hits for the same user).
	if again := New("token-A", server).cacheKey(); again != a {
		t.Fatalf("same token+server must be stable: %q != %q", again, a)
	}

	// Same token, different cluster URL must not collide.
	other := New("token-A", "https://other.svc").cacheKey()
	if other == a {
		t.Fatalf("different clusters must produce different keys, both = %q", a)
	}

	// The cluster URL is part of the key (callers rely on it for per-cluster scoping).
	if !strings.HasSuffix(a, ":"+server) {
		t.Fatalf("cache key %q must end with the cluster URL", a)
	}

	// The raw token must never appear in the key (it must be a fingerprint).
	if strings.Contains(a, "token-A") {
		t.Fatalf("cache key %q must not contain the raw token", a)
	}
}

func TestClusterCache_GetSetExpiry(t *testing.T) {
	c := newClusterCache[string]()

	if _, ok := c.get("missing"); ok {
		t.Fatal("get on empty cache should miss")
	}

	c.set("k", "v", time.Minute)
	if v, ok := c.get("k"); !ok || v != "v" {
		t.Fatalf("expected hit v=%q ok=%v", v, ok)
	}

	// An already-expired entry must be treated as a miss.
	c.set("stale", "old", -time.Second)
	if _, ok := c.get("stale"); ok {
		t.Fatal("expired entry should miss")
	}
}
