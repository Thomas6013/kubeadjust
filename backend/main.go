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
		allowedOrigins = strings.Split(origins, ",")
	} else {
		log.Println("WARN: ALLOWED_ORIGINS not set, defaulting to wildcard (*)")
	}

	r := chi.NewRouter()

	// Global middleware
	r.Use(chiMiddleware.Logger)
	r.Use(chiMiddleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   allowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           300,
	}))

	// Health check (no auth required)
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	// API routes — all require a valid bearer token
	r.Route("/api", func(r chi.Router) {
		r.Use(middleware.BearerToken)

		// Auth
		r.Get("/auth/verify", handlers.VerifyToken)

		// Cluster-wide node overview
		r.Get("/nodes", handlers.ListNodes)

		// Namespaces
		r.Get("/namespaces", handlers.ListNamespaces)

		// Deployments + pod resource details
		r.Get("/namespaces/{namespace}/deployments", handlers.ListDeployments)

		// Raw pod metrics (optional, useful for debugging)
		r.Get("/namespaces/{namespace}/metrics", handlers.GetPodMetrics)

		// Prometheus history (requires PROMETHEUS_URL env var)
		r.Get("/namespaces/{namespace}/prometheus", handlers.GetNamespaceHistory)
		r.Get("/namespaces/{namespace}/prometheus/{pod}/{container}", handlers.GetContainerHistory)
	})

	log.Printf("kubeadjust backend listening on :%s", port)
	if err := http.ListenAndServe(":"+port, r); err != nil {
		log.Fatal(err)
	}
}
