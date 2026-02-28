package handlers

import (
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/devops-kubeadjust/backend/prometheus"
	"github.com/devops-kubeadjust/backend/resources"
)

// NewContainerHistoryHandler returns a handler using the given Prometheus client.
func NewContainerHistoryHandler(client *prometheus.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "namespace")
		pod := chi.URLParam(r, "pod")
		container := chi.URLParam(r, "container")

		if !resources.IsValidLabelValue(ns) || !resources.IsValidLabelValue(pod) || !resources.IsValidLabelValue(container) {
			jsonError(w, "invalid parameter", http.StatusBadRequest)
			return
		}

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
}

// NewNamespaceHistoryHandler returns a handler using the given Prometheus client.
func NewNamespaceHistoryHandler(client *prometheus.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ns := chi.URLParam(r, "namespace")

		if !resources.IsValidLabelValue(ns) {
			jsonError(w, "invalid parameter", http.StatusBadRequest)
			return
		}

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
}
