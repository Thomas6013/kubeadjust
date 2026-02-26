package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/devops-kubeadjust/backend/k8s"
	"github.com/devops-kubeadjust/backend/middleware"
)

type NamespaceItem struct {
	Name string `json:"name"`
}

// ListNamespaces returns all namespaces the token has access to.
func ListNamespaces(w http.ResponseWriter, r *http.Request) {
	token := middleware.TokenFromContext(r.Context())
	client := k8s.New(token, "")
	list, err := client.ListNamespaces()
	if err != nil {
		log.Printf("failed to list namespaces: %v", err)
		jsonError(w, "internal server error", http.StatusInternalServerError)
		return
	}
	result := make([]NamespaceItem, 0, len(list.Items))
	for _, ns := range list.Items {
		result = append(result, NamespaceItem{Name: ns.Metadata.Name})
	}
	jsonOK(w, result)
}

// jsonOK writes v as JSON with 200 OK.
func jsonOK(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// jsonError writes a JSON {"error": msg} response with the given HTTP status code.
func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
