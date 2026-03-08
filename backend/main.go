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

	// OIDC mode: OIDC_ENABLED=true + SA tokens per cluster
	oidcEnabled := os.Getenv("OIDC_ENABLED") == "true"
	var oidcHandler *handlers.OIDCHandler
	var saTokens map[string]string

	if oidcEnabled {
		issuerURL := os.Getenv("OIDC_ISSUER_URL")
		clientID := os.Getenv("OIDC_CLIENT_ID")
		clientSecret := os.Getenv("OIDC_CLIENT_SECRET")
		redirectURL := os.Getenv("OIDC_REDIRECT_URL")
		sessionSecret := []byte(os.Getenv("SESSION_SECRET"))

		var missing []string
		if issuerURL == "" {
			missing = append(missing, "OIDC_ISSUER_URL")
		}
		if clientID == "" {
			missing = append(missing, "OIDC_CLIENT_ID")
		}
		if clientSecret == "" {
			missing = append(missing, "OIDC_CLIENT_SECRET")
		}
		if redirectURL == "" {
			missing = append(missing, "OIDC_REDIRECT_URL")
		}
		if len(sessionSecret) < 32 {
			missing = append(missing, "SESSION_SECRET (must be ≥32 chars)")
		}
		if len(missing) > 0 {
			log.Fatalf("OIDC_ENABLED=true but missing required env vars: %s", strings.Join(missing, ", "))
		}

		saTokens = parseSATokens()
		if len(saTokens) == 0 {
			log.Fatal("OIDC_ENABLED=true but no SA tokens configured (set SA_TOKEN or SA_TOKENS)")
		}

		h, err := handlers.NewOIDCHandler(issuerURL, clientID, clientSecret, redirectURL, sessionSecret)
		if err != nil {
			log.Fatalf("OIDC init failed: %v", err)
		}
		oidcHandler = h
		log.Printf("OIDC mode enabled (issuer: %s, %d SA token(s))", issuerURL, len(saTokens))
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
		r.Get("/auth/config", handlers.AuthConfig(oidcEnabled))

		if oidcEnabled {
			// OIDC-specific endpoints: called server-side by Next.js, not by the browser directly.
			r.Get("/auth/loginurl", oidcHandler.LoginURL())
			r.Post("/auth/session", oidcHandler.CreateSession())
		}

		// Auth + cluster-routing required
		r.Group(func(r chi.Router) {
			if oidcEnabled {
				r.Use(middleware.ClusterURL(clusters))
				r.Use(middleware.SessionAuth(saTokens, []byte(os.Getenv("SESSION_SECRET"))))
			} else {
				r.Use(middleware.BearerToken)
				r.Use(middleware.ClusterURL(clusters))
			}
			r.Use(chiMiddleware.Throttle(20)) // max 20 concurrent requests

			// Auth
			r.Get("/auth/verify", handlers.VerifyToken)

			// Cluster-wide node overview
			r.Get("/nodes", handlers.ListNodes)
			r.Get("/nodes/{node}/pods", handlers.GetNodePods)

			// Namespaces
			r.Get("/namespaces", handlers.ListNamespaces)
			r.Get("/namespaces/stats", handlers.GetNamespaceStats)

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

// parseSATokens reads SA tokens from three sources (last write wins for a given cluster name):
//   - SA_TOKEN           → stored under "default" (single-cluster override)
//   - SA_TOKENS          → "prod=token1,staging=token2" (legacy multi-cluster)
//   - SA_TOKEN_<CLUSTER> → one env var per cluster, e.g. SA_TOKEN_PROD (Helm-preferred)
//
// If no "default" token is found from env vars, falls back to the in-cluster SA token
// mounted at /var/run/secrets/kubernetes.io/serviceaccount/token.
// Cluster names are lower-cased when derived from the SA_TOKEN_* prefix.
func parseSATokens() map[string]string {
	tokens := make(map[string]string)
	if t := os.Getenv("SA_TOKEN"); t != "" {
		tokens["default"] = t
	}
	if env := os.Getenv("SA_TOKENS"); env != "" {
		for _, pair := range strings.Split(env, ",") {
			pair = strings.TrimSpace(pair)
			idx := strings.Index(pair, "=")
			if idx <= 0 {
				continue
			}
			name := strings.TrimSpace(pair[:idx])
			token := strings.TrimSpace(pair[idx+1:])
			if name != "" && token != "" {
				tokens[name] = token
			}
		}
	}
	for _, env := range os.Environ() {
		if !strings.HasPrefix(env, "SA_TOKEN_") {
			continue
		}
		idx := strings.Index(env, "=")
		if idx <= 0 {
			continue
		}
		name := strings.ToLower(strings.ReplaceAll(env[len("SA_TOKEN_"):idx], "_", "-"))
		token := env[idx+1:]
		if name != "" && token != "" {
			tokens[name] = token
		}
	}
	if _, ok := tokens["default"]; !ok {
		if b, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/token"); err == nil {
			if t := strings.TrimSpace(string(b)); t != "" {
				tokens["default"] = t
				log.Printf("OIDC: using in-cluster SA token for default cluster")
			}
		}
	}
	return tokens
}
