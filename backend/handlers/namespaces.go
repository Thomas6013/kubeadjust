package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"sort"
	"sync"

	"github.com/devops-kubeadjust/backend/k8s"
	"github.com/devops-kubeadjust/backend/middleware"
	"github.com/devops-kubeadjust/backend/resources"
	"golang.org/x/sync/errgroup"
)

type NamespaceItem struct {
	Name string `json:"name"`
}

// ListNamespaces returns namespaces that contain at least one pod.
func ListNamespaces(w http.ResponseWriter, r *http.Request) {
	token := middleware.TokenFromContext(r.Context())
	client := k8s.New(token, middleware.ClusterURLFromContext(r.Context()))
	list, err := client.ListNamespaces(r.Context())
	if err != nil {
		log.Printf("failed to list namespaces: %v", err)
		jsonError(w, "internal server error", http.StatusInternalServerError)
		return
	}

	var mu sync.Mutex
	result := make([]NamespaceItem, 0, len(list.Items))
	g, ctx := errgroup.WithContext(r.Context())
	g.SetLimit(10)

	for _, ns := range list.Items {
		name := ns.Metadata.Name
		g.Go(func() error {
			pods, err := client.ListPodsLimit(ctx, name, 1)
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

	if err := g.Wait(); err != nil {
		log.Printf("namespace pod check error: %v", err)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	jsonOK(w, result)
}

// NamespaceStats holds aggregated limit/request ratios and live usage for a namespace.
type NamespaceStats struct {
	Name          string  `json:"name"`
	CPURequestedM int64   `json:"cpuRequestedM"`
	CPULimitedM   int64   `json:"cpuLimitedM"`
	MemRequestedB int64   `json:"memRequestedB"`
	MemLimitedB   int64   `json:"memLimitedB"`
	CPUUsageM     int64   `json:"cpuUsageM"`  // 0 if metrics-server unavailable
	MemUsageB     int64   `json:"memUsageB"`  // 0 if metrics-server unavailable
	CPURatio      float64 `json:"cpuRatio"` // lim/req; 0 if no requests
	MemRatio      float64 `json:"memRatio"`
}

// GetNamespaceStats returns per-namespace limit/request ratios and live usage.
// Pods and pod metrics are fetched concurrently; metrics are best-effort (0 if unavailable).
func GetNamespaceStats(w http.ResponseWriter, r *http.Request) {
	token := middleware.TokenFromContext(r.Context())
	client := k8s.New(token, middleware.ClusterURLFromContext(r.Context()))

	var allPods *k8s.PodList
	var allMetrics *k8s.PodMetricsList

	g, ctx := errgroup.WithContext(r.Context())
	g.Go(func() error {
		p, err := client.ListAllPods(ctx)
		if err != nil {
			return err
		}
		allPods = p
		return nil
	})
	g.Go(func() error {
		m, err := client.ListAllPodMetrics(ctx)
		if err != nil {
			log.Printf("pod metrics unavailable for namespace stats: %v", err)
			return nil // best-effort
		}
		allMetrics = m
		return nil
	})

	if err := g.Wait(); err != nil {
		log.Printf("failed to list pods for namespace stats: %v", err)
		jsonError(w, "internal server error", http.StatusInternalServerError)
		return
	}

	type agg struct{ cpuReq, cpuLim, memReq, memLim, cpuUsage, memUsage int64 }
	nsAgg := map[string]*agg{}

	for _, pod := range allPods.Items {
		if pod.Status.Phase == "Succeeded" || pod.Status.Phase == "Failed" {
			continue
		}
		name := pod.Metadata.Namespace
		if nsAgg[name] == nil {
			nsAgg[name] = &agg{}
		}
		a := nsAgg[name]
		for _, c := range pod.Spec.Containers {
			a.cpuReq += resources.ParseCPUMillicores(c.Resources.Requests["cpu"])
			a.cpuLim += resources.ParseCPUMillicores(c.Resources.Limits["cpu"])
			a.memReq += resources.ParseMemoryBytes(c.Resources.Requests["memory"])
			a.memLim += resources.ParseMemoryBytes(c.Resources.Limits["memory"])
		}
	}

	if allMetrics != nil {
		for _, pm := range allMetrics.Items {
			ns := pm.Metadata.Namespace
			if nsAgg[ns] == nil {
				nsAgg[ns] = &agg{}
			}
			a := nsAgg[ns]
			for _, c := range pm.Containers {
				a.cpuUsage += resources.ParseCPUMillicores(c.Usage["cpu"])
				a.memUsage += resources.ParseMemoryBytes(c.Usage["memory"])
			}
		}
	}

	result := make([]NamespaceStats, 0, len(nsAgg))
	for name, a := range nsAgg {
		s := NamespaceStats{
			Name:          name,
			CPURequestedM: a.cpuReq,
			CPULimitedM:   a.cpuLim,
			MemRequestedB: a.memReq,
			MemLimitedB:   a.memLim,
			CPUUsageM:     a.cpuUsage,
			MemUsageB:     a.memUsage,
		}
		if a.cpuReq > 0 {
			s.CPURatio = float64(a.cpuLim) / float64(a.cpuReq)
		}
		if a.memReq > 0 {
			s.MemRatio = float64(a.memLim) / float64(a.memReq)
		}
		result = append(result, s)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	jsonOK(w, result)
}

// jsonOK writes v as JSON with 200 OK.
func jsonOK(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("failed to encode JSON response: %v", err)
	}
}

// jsonError writes a JSON {"error": msg} response with the given HTTP status code.
func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	if err := json.NewEncoder(w).Encode(map[string]string{"error": msg}); err != nil {
		log.Printf("failed to encode error response: %v", err)
	}
}
