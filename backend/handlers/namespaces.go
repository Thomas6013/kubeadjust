package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/devops-kubeadjust/backend/k8s"
	"github.com/devops-kubeadjust/backend/middleware"
)

type NamespaceItem struct {
	Name string `json:"name"`
}

func ListNamespaces(w http.ResponseWriter, r *http.Request) {
	token := middleware.TokenFromContext(r.Context())
	if isMock(token) {
		jsonOK(w, mockNamespaces())
		return
	}
	client := k8s.New(token, "")
	list, err := client.ListNamespaces()
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	result := make([]NamespaceItem, 0, len(list.Items))
	for _, ns := range list.Items {
		result = append(result, NamespaceItem{Name: ns.Metadata.Name})
	}
	jsonOK(w, result)
}

func jsonOK(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
