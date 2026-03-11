package handlers

import (
	"net/http"
	"sort"
)

type ClusterItem struct {
	Name    string `json:"name"`
	Managed bool   `json:"managed"` // true when the backend has an SA token for this cluster
}

// ListClusters returns the sorted list of configured cluster names.
// Clusters whose name has a matching SA token are marked as managed (no user token required).
// Does not require authentication — cluster names are not sensitive.
func ListClusters(clusters map[string]string, saTokens map[string]string) http.HandlerFunc {
	items := make([]ClusterItem, 0, len(clusters))
	for name := range clusters {
		_, managed := saTokens[name]
		items = append(items, ClusterItem{Name: name, Managed: managed})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Name < items[j].Name })

	return func(w http.ResponseWriter, r *http.Request) {
		jsonOK(w, items)
	}
}
