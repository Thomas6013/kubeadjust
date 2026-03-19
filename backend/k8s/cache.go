package k8s

import (
	"sync"
	"time"
)

const (
	ttlShort = 30 * time.Second
	ttlLong  = 60 * time.Second
)

// Package-level caches keyed by API server URL (cluster-scoped, not per-user).
// All cached data is read-only — callers must not mutate returned pointers.
var (
	allPodsCache       = newClusterCache[*PodList]()
	nodesCache         = newClusterCache[*NodeList]()
	nodeMetricsCache   = newClusterCache[*NodeMetricsList]()
	allPodMetricsCache = newClusterCache[*PodMetricsList]()
	nodeSummaryCache   = newClusterCache[*NodeSummary]()
)

type cacheEntry[T any] struct {
	value     T
	expiresAt time.Time
}

func (e *cacheEntry[T]) valid() bool {
	return time.Now().Before(e.expiresAt)
}

// clusterCache is a generic TTL cache keyed by an arbitrary string.
// Safe for concurrent use.
type clusterCache[T any] struct {
	mu      sync.RWMutex
	entries map[string]*cacheEntry[T]
}

func newClusterCache[T any]() *clusterCache[T] {
	return &clusterCache[T]{entries: make(map[string]*cacheEntry[T])}
}

func (c *clusterCache[T]) get(key string) (T, bool) {
	c.mu.RLock()
	e, ok := c.entries[key]
	c.mu.RUnlock()
	if ok && e.valid() {
		return e.value, true
	}
	var zero T
	return zero, false
}

func (c *clusterCache[T]) set(key string, value T, ttl time.Duration) {
	c.mu.Lock()
	c.entries[key] = &cacheEntry[T]{value: value, expiresAt: time.Now().Add(ttl)}
	c.mu.Unlock()
}
