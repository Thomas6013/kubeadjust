package handlers

import (
	"net/http"
	"sort"
)

type ClusterItem struct {
	Name string `json:"name"`
}

// ListClusters returns the sorted list of configured cluster names.
// Does not require authentication — cluster names are not sensitive.
func ListClusters(clusters map[string]string) http.HandlerFunc {
	items := make([]ClusterItem, 0, len(clusters))
	for name := range clusters {
		items = append(items, ClusterItem{Name: name})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Name < items[j].Name })

	return func(w http.ResponseWriter, r *http.Request) {
		jsonOK(w, items)
	}
}
