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
// In single-cluster mode (no CLUSTERS env var), always exposes "default" when a default SA
// token is available (env SA_TOKEN or in-cluster mount), so the frontend can show the badge.
// Does not require authentication — cluster names are not sensitive.
func ListClusters(clusters map[string]string, saTokens map[string]string, hasInClusterDefault bool) http.HandlerFunc {
	items := make([]ClusterItem, 0, len(clusters))
	for name := range clusters {
		_, managed := saTokens[name]
		items = append(items, ClusterItem{Name: name, Managed: managed})
	}
	// Always expose "default" when a default SA token exists and "default" is not already
	// an explicitly configured cluster. This covers both single-cluster mode and multi-cluster
	// mode where the in-cluster SA is available alongside other named clusters.
	if _, alreadyConfigured := clusters["default"]; !alreadyConfigured {
		if _, ok := saTokens["default"]; ok || hasInClusterDefault {
			items = append(items, ClusterItem{Name: "default", Managed: true})
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Name < items[j].Name })

	return func(w http.ResponseWriter, r *http.Request) {
		jsonOK(w, items)
	}
}
