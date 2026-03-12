package middleware

import (
	"context"
	"net/http"
)

type clusterURLKey struct{}

// ClusterURL is middleware that reads the X-Cluster request header and injects
// the corresponding Kubernetes API server URL into the request context.
// If clusters is empty (single-cluster mode), the header is ignored and
// handlers fall back to the KUBE_API_SERVER environment variable.
func ClusterURL(clusters map[string]string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if len(clusters) == 0 {
				next.ServeHTTP(w, r)
				return
			}

			name := r.Header.Get("X-Cluster")
			if name == "" {
				// Single configured cluster — use it automatically without requiring the header.
				if len(clusters) == 1 {
					for _, url := range clusters {
						r = r.WithContext(context.WithValue(r.Context(), clusterURLKey{}, url))
					}
					next.ServeHTTP(w, r)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"X-Cluster header is required"}`))
				return
			}

			url, ok := clusters[name]
			if !ok {
				if name == "default" {
					// "default" cluster uses KUBE_API_SERVER (in-cluster) — no URL override needed.
					next.ServeHTTP(w, r)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"unknown cluster"}`))
				return
			}

			r = r.WithContext(context.WithValue(r.Context(), clusterURLKey{}, url))
			next.ServeHTTP(w, r)
		})
	}
}

// ClusterURLFromContext returns the Kubernetes API server URL injected by the
// ClusterURL middleware. Returns "" if not set — k8s.New will then fall back
// to the KUBE_API_SERVER environment variable.
func ClusterURLFromContext(ctx context.Context) string {
	url, _ := ctx.Value(clusterURLKey{}).(string)
	return url
}
