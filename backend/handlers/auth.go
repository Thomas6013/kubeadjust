package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/devops-kubeadjust/backend/k8s"
	"github.com/devops-kubeadjust/backend/middleware"
)

// VerifyToken checks whether the provided token can reach the Kubernetes API.
func VerifyToken(w http.ResponseWriter, r *http.Request) {
	token := middleware.TokenFromContext(r.Context())
	client := k8s.New(token, "")
	if err := client.VerifyToken(); err != nil {
		jsonError(w, "invalid token: "+err.Error(), http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
