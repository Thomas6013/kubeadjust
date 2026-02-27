package handlers

import (
	"log"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/devops-kubeadjust/backend/prometheus"
)

// GetContainerHistory returns CPU/memory history from Prometheus for a single container.
func GetContainerHistory(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	pod := chi.URLParam(r, "pod")
	container := chi.URLParam(r, "container")

	if !isValidLabelValue(ns) || !isValidLabelValue(pod) || !isValidLabelValue(container) {
		jsonError(w, "invalid parameter", http.StatusBadRequest)
		return
	}

	client := prometheus.New()
	if client == nil {
		jsonError(w, "prometheus not configured", http.StatusServiceUnavailable)
		return
	}

	tr := prometheus.ParseTimeRange(r.URL.Query().Get("range"))

	result, err := client.GetContainerHistory(ns, pod, container, tr)
	if err != nil {
		log.Printf("prometheus query failed for %s/%s/%s: %v", ns, pod, container, err)
		jsonError(w, "failed to query prometheus", http.StatusBadGateway)
		return
	}

	jsonOK(w, result)
}

// GetNamespaceHistory returns CPU/memory history for all containers in a namespace.
func GetNamespaceHistory(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")

	if !isValidLabelValue(ns) {
		jsonError(w, "invalid parameter", http.StatusBadRequest)
		return
	}

	client := prometheus.New()
	if client == nil {
		jsonError(w, "prometheus not configured", http.StatusServiceUnavailable)
		return
	}

	tr := prometheus.ParseTimeRange(r.URL.Query().Get("range"))

	result, err := client.GetNamespaceHistory(ns, tr)
	if err != nil {
		log.Printf("prometheus namespace query failed for %s: %v", ns, err)
		jsonError(w, "failed to query prometheus", http.StatusBadGateway)
		return
	}

	jsonOK(w, result)
}

// isValidLabelValue rejects strings that contain characters which would break PromQL label syntax.
func isValidLabelValue(s string) bool {
	return s != "" && !strings.ContainsAny(s, `"{}\\`)
}
