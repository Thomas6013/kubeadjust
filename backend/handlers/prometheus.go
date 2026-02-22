package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/devops-kubeadjust/backend/prometheus"
)

// GetContainerHistory returns last-1h CPU/memory history from Prometheus.
// Returns 503 if PROMETHEUS_URL is not configured.
func GetContainerHistory(w http.ResponseWriter, r *http.Request) {
	ns        := chi.URLParam(r, "namespace")
	pod       := chi.URLParam(r, "pod")
	container := chi.URLParam(r, "container")

	client := prometheus.New()
	if client == nil {
		jsonError(w, "prometheus not configured", http.StatusServiceUnavailable)
		return
	}

	result, err := client.GetContainerHistory(ns, pod, container)
	if err != nil {
		jsonError(w, err.Error(), http.StatusBadGateway)
		return
	}

	jsonOK(w, result)
}
