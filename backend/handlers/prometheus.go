package handlers

import (
	"log"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/devops-kubeadjust/backend/prometheus"
)

// GetContainerHistory returns last-1h CPU/memory history from Prometheus.
// Returns 503 if PROMETHEUS_URL is not configured.
func GetContainerHistory(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	pod := chi.URLParam(r, "pod")
	container := chi.URLParam(r, "container")

	// Reject values containing Prometheus label-breaking characters to prevent PromQL injection.
	if !isValidLabelValue(ns) || !isValidLabelValue(pod) || !isValidLabelValue(container) {
		jsonError(w, "invalid parameter", http.StatusBadRequest)
		return
	}

	client := prometheus.New()
	if client == nil {
		jsonError(w, "prometheus not configured", http.StatusServiceUnavailable)
		return
	}

	result, err := client.GetContainerHistory(ns, pod, container)
	if err != nil {
		log.Printf("prometheus query failed for %s/%s/%s: %v", ns, pod, container, err)
		jsonError(w, "failed to query prometheus", http.StatusBadGateway)
		return
	}

	jsonOK(w, result)
}

// isValidLabelValue rejects strings that contain characters which would break PromQL label syntax.
func isValidLabelValue(s string) bool {
	return s != "" && !strings.ContainsAny(s, `"{}\\`)
}
