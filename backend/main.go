package main

import (
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"github.com/devops-kubeadjust/backend/handlers"
	"github.com/devops-kubeadjust/backend/middleware"
	"github.com/devops-kubeadjust/backend/prometheus"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	if os.Getenv("KUBE_INSECURE_TLS") == "true" {
		log.Println("WARN: TLS verification disabled (KUBE_INSECURE_TLS=true)")
	}

	// CORS origins: default to wildcard in dev, restrict via ALLOWED_ORIGINS in production
	allowedOrigins := []string{"*"}
	if origins := os.Getenv("ALLOWED_ORIGINS"); origins != "" {
		parts := strings.Split(origins, ",")
		allowedOrigins = make([]string, 0, len(parts))
		for _, o := range parts {
			if trimmed := strings.TrimSpace(o); trimmed != "" {
				allowedOrigins = append(allowedOrigins, trimmed)
			}
		}
	} else {
		log.Println("WARN: ALLOWED_ORIGINS not set, defaulting to wildcard (*)")
	}

	// Multi-cluster support: CLUSTERS="prod=https://...,staging=https://..."
	// If not set, single-cluster mode uses KUBE_API_SERVER.
	clusters := parseClusters(os.Getenv("CLUSTERS"))
	if len(clusters) > 0 {
		log.Printf("Multi-cluster mode: %d cluster(s) configured", len(clusters))
	}

	// Create Prometheus client once at startup (nil if PROMETHEUS_URL not set)
	promClient := prometheus.New()
	if promClient != nil {
		log.Println("Prometheus client configured")
	}

	r := chi.NewRouter()

	// Global middleware
	r.Use(chiMiddleware.Logger)
	r.Use(chiMiddleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   allowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type", "X-Cluster"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	// Health check (no auth required)
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	r.Route("/api", func(r chi.Router) {
		// Public — no auth required
		r.Get("/clusters", handlers.ListClusters(clusters))

		// Auth + cluster-routing required
		r.Group(func(r chi.Router) {
			r.Use(middleware.BearerToken)
			r.Use(middleware.ClusterURL(clusters))
			r.Use(chiMiddleware.Throttle(20)) // max 20 concurrent requests

			// Auth
			r.Get("/auth/verify", handlers.VerifyToken)

			// Cluster-wide node overview
			r.Get("/nodes", handlers.ListNodes)
			r.Get("/nodes/{node}/pods", handlers.GetNodePods)

			// Namespaces
			r.Get("/namespaces", handlers.ListNamespaces)

			// Deployments + pod resource details
			r.Get("/namespaces/{namespace}/deployments", handlers.ListDeployments)

			// Raw pod metrics (optional, useful for debugging)
			r.Get("/namespaces/{namespace}/metrics", handlers.GetPodMetrics)

			// Prometheus history (requires PROMETHEUS_URL env var)
			r.Get("/namespaces/{namespace}/prometheus", handlers.NewNamespaceHistoryHandler(promClient))
			r.Get("/namespaces/{namespace}/prometheus/{pod}/{container}", handlers.NewContainerHistoryHandler(promClient))
		})
	})

	log.Printf("kubeadjust backend listening on :%s", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatal(err)
	}
}

// parseClusters parses "name=url,name2=url2" into a map[name]url.
func parseClusters(env string) map[string]string {
	clusters := make(map[string]string)
	if env == "" {
		return clusters
	}
	for _, pair := range strings.Split(env, ",") {
		pair = strings.TrimSpace(pair)
		idx := strings.Index(pair, "=")
		if idx <= 0 {
			continue
		}
		name := strings.TrimSpace(pair[:idx])
		url := strings.TrimSpace(pair[idx+1:])
		if name != "" && url != "" {
			clusters[name] = url
		}
	}
	return clusters
}
