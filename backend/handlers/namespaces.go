package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"sort"
	"sync"

	"github.com/devops-kubeadjust/backend/k8s"
	"github.com/devops-kubeadjust/backend/middleware"
	"golang.org/x/sync/errgroup"
)

type NamespaceItem struct {
	Name string `json:"name"`
}

// ListNamespaces returns namespaces that contain at least one pod.
func ListNamespaces(w http.ResponseWriter, r *http.Request) {
	token := middleware.TokenFromContext(r.Context())
	client := k8s.New(token, "")
	list, err := client.ListNamespaces()
	if err != nil {
		log.Printf("failed to list namespaces: %v", err)
		jsonError(w, "internal server error", http.StatusInternalServerError)
		return
	}

	var mu sync.Mutex
	result := make([]NamespaceItem, 0, len(list.Items))
	g, _ := errgroup.WithContext(r.Context())
	g.SetLimit(10)

	for _, ns := range list.Items {
		name := ns.Metadata.Name
		g.Go(func() error {
			pods, err := client.ListPodsLimit(name, 1)
			if err != nil {
				log.Printf("failed to check pods in %s: %v", name, err)
				return nil // skip namespace, don't fail the whole request
			}
			if len(pods.Items) > 0 {
				mu.Lock()
				result = append(result, NamespaceItem{Name: name})
				mu.Unlock()
			}
			return nil
		})
	}

	_ = g.Wait()
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
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
