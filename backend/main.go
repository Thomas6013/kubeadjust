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

	// SA tokens: used in OIDC mode and in managed-SA mode (no OIDC, backend holds the token).
	saTokens := parseSATokens()
	// Detect in-cluster SA token (not stored — ManagedAuth re-reads per-request to avoid staleness).
	hasInClusterDefault := false
	if _, ok := saTokens["default"]; !ok {
		if b, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/token"); err == nil {
			if strings.TrimSpace(string(b)) != "" {
				hasInClusterDefault = true
				log.Printf("in-cluster SA token detected for default cluster (read fresh per-request)")
			}
		}
	}

	// OIDC mode: OIDC_ENABLED=true + SA tokens per cluster
	oidcEnabled := os.Getenv("OIDC_ENABLED") == "true"
	var oidcHandler *handlers.OIDCHandler

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
		// OIDC redirect URL must use HTTPS to prevent authorization code leakage over plaintext HTTP.
		if !strings.HasPrefix(redirectURL, "https://") {
			log.Fatal("OIDC_REDIRECT_URL must use HTTPS (starts with https://)")
		}

		if len(saTokens) == 0 {
			log.Fatal("OIDC_ENABLED=true but no SA tokens configured (set SA_TOKEN or SA_TOKENS)")
		}
		// Warn if a configured cluster has no matching SA token (common misconfiguration).
		for name := range clusters {
			if _, ok := saTokens[name]; !ok {
				log.Printf("WARN: cluster %q has no SA token — set SA_TOKEN_%s or SA_TOKENS", name, strings.ToUpper(strings.ReplaceAll(name, "-", "_")))
			}
		}

		var requiredGroups []string
		if groups := os.Getenv("OIDC_GROUPS"); groups != "" {
			for g := range strings.SplitSeq(groups, ",") {
				if g = strings.TrimSpace(g); g != "" {
					requiredGroups = append(requiredGroups, g)
				}
			}
		}

		h, err := handlers.NewOIDCHandler(issuerURL, clientID, clientSecret, redirectURL, sessionSecret, requiredGroups)
		if err != nil {
			log.Fatalf("OIDC init failed: %v", err)
		}
		oidcHandler = h
		if len(requiredGroups) > 0 {
			log.Printf("OIDC mode enabled (issuer: %s, %d SA token(s), required groups: %v)", issuerURL, len(saTokens), requiredGroups)
		} else {
			log.Printf("OIDC mode enabled (issuer: %s, %d SA token(s), WARN: no OIDC_GROUPS set — any authenticated user can access)", issuerURL, len(saTokens))
		}
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

	// managedDefault: single-cluster mode where the backend holds the SA token (no OIDC, no CLUSTERS).
	// Tells the frontend to skip token entry and go straight to dashboard.
	managedDefault := !oidcEnabled && len(clusters) == 0 && (saTokens["default"] != "" || hasInClusterDefault)
	if !oidcEnabled && (len(saTokens) > 0 || hasInClusterDefault) {
		names := make([]string, 0, len(saTokens)+1)
		for n := range saTokens {
			names = append(names, n)
		}
		if hasInClusterDefault {
			names = append(names, "default (in-cluster, refreshed per-request)")
		}
		log.Printf("Managed SA token mode: %d SA token(s) configured for clusters: %v", len(names), names)
	} else if !oidcEnabled {
		log.Printf("WARN: no SA tokens configured — users must supply their own bearer token")
	}

	r.Route("/api", func(r chi.Router) {
		// Public — no auth required
		r.Get("/clusters", handlers.ListClusters(clusters, saTokens))
		r.Get("/auth/config", handlers.AuthConfig(oidcEnabled, managedDefault))

		if oidcEnabled {
			// OIDC-specific endpoints: called server-side by Next.js, not by the browser directly.
			r.Group(func(r chi.Router) {
				r.Use(chiMiddleware.Throttle(10))
				r.Get("/auth/loginurl", oidcHandler.LoginURL())
				r.Post("/auth/session", oidcHandler.CreateSession())
			})
		}

		// Auth + cluster-routing required
		r.Group(func(r chi.Router) {
			if oidcEnabled {
				r.Use(middleware.ClusterURL(clusters))
				r.Use(middleware.SessionAuth(saTokens, []byte(os.Getenv("SESSION_SECRET"))))
			} else if len(saTokens) > 0 {
				// Managed SA token mode: user token optional, falls back to SA token per cluster.
				r.Use(middleware.ManagedAuth(saTokens))
				r.Use(middleware.ClusterURL(clusters))
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
	for pair := range strings.SplitSeq(env, ",") {
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
		for pair := range strings.SplitSeq(env, ",") {
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
	// Note: in-cluster SA token (/var/run/secrets/kubernetes.io/serviceaccount/token) is NOT
	// read here — it is re-read per-request by ManagedAuth to stay current as kubelet rotates it.
	return tokens
}
