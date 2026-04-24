package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/devops-kubeadjust/backend/k8s"
	"github.com/devops-kubeadjust/backend/middleware"
)

// VerifyToken checks whether the provided token can reach the Kubernetes API.
func VerifyToken(w http.ResponseWriter, r *http.Request) {
	token := middleware.TokenFromContext(r.Context())
	client := k8s.New(token, middleware.ClusterURLFromContext(r.Context()))
	if err := client.VerifyToken(r.Context()); err != nil {
		log.Printf("token verification failed: %v", err)
		jsonError(w, "authentication failed", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
		log.Printf("failed to encode verify response: %v", err)
	}
}
