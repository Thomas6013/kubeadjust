package handlers

import (
	"fmt"
	"log"
	"math"
	"net/http"
	"sort"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/devops-kubeadjust/backend/k8s"
	"github.com/devops-kubeadjust/backend/middleware"
	"github.com/devops-kubeadjust/backend/resources"
)

func nodeAge(creationTimestamp string) string {
	t, err := time.Parse(time.RFC3339, creationTimestamp)
	if err != nil {
		return ""
	}
	d := time.Since(t)
	days := int(math.Round(d.Hours() / 24))
	switch {
	case days >= 365:
		return fmt.Sprintf("%dy", days/365)
	case days >= 1:
		return fmt.Sprintf("%dd", days)
	default:
		return fmt.Sprintf("%dh", int(d.Hours()))
	}
}

func nodePressures(conditions []k8s.NodeCondition) (disk, memory, pid bool) {
	for _, c := range conditions {
		if c.Status != "True" {
			continue
		}
		switch c.Type {
		case "DiskPressure":
			disk = true
		case "MemoryPressure":
			memory = true
		case "PIDPressure":
			pid = true
		}
	}
	return
}

// ListNodes returns a cluster-wide node overview with resource aggregation.
func ListNodes(w http.ResponseWriter, r *http.Request) {
	token := middleware.TokenFromContext(r.Context())
	client := k8s.New(token, middleware.ClusterURLFromContext(r.Context()))

	nodes, err := client.ListNodes()
	if err != nil {
		log.Printf("failed to list nodes: %v", err)
		jsonError(w, "internal server error", http.StatusInternalServerError)
		return
	}

	// All pods across namespaces for request/limit aggregation per node
	allPods, err := client.ListAllPods()
	if err != nil {
		log.Printf("failed to list all pods: %v", err)
		jsonError(w, "internal server error", http.StatusInternalServerError)
		return
	}

	// Node metrics (best-effort)
	nodeMetrics := map[string]k8s.NodeMetrics{}
	if nm, err := client.ListNodeMetrics(); err == nil {
		for _, m := range nm.Items {
			nodeMetrics[m.Metadata.Name] = m
		}
	}

	// Aggregate pod requests/limits per node
	type aggResources struct {
		cpuReq, memReq int64
		cpuLim, memLim int64
		podCount       int
	}
	agg := map[string]*aggResources{}
	for _, pod := range allPods.Items {
		node := pod.Spec.NodeName
		if node == "" || pod.Status.Phase == "Succeeded" || pod.Status.Phase == "Failed" {
			continue
		}
		if agg[node] == nil {
			agg[node] = &aggResources{}
		}
		agg[node].podCount++
		for _, c := range pod.Spec.Containers {
			agg[node].cpuReq += resources.ParseCPUMillicores(c.Resources.Requests["cpu"])
			agg[node].memReq += resources.ParseMemoryBytes(c.Resources.Requests["memory"])
			agg[node].cpuLim += resources.ParseCPUMillicores(c.Resources.Limits["cpu"])
			agg[node].memLim += resources.ParseMemoryBytes(c.Resources.Limits["memory"])
		}
	}

	result := make([]resources.NodeOverview, 0, len(nodes.Items))
	for _, node := range nodes.Items {
		overview := resources.NodeOverview{
			Name:  node.Metadata.Name,
			Roles: resources.NodeRoles(node.Metadata.Labels),
			Capacity: resources.NodeResources{
				CPU:    resources.ParseResource(node.Status.Capacity["cpu"], true),
				Memory: resources.ParseResource(node.Status.Capacity["memory"], false),
			},
			Allocatable: resources.NodeResources{
				CPU:    resources.ParseResource(node.Status.Allocatable["cpu"], true),
				Memory: resources.ParseResource(node.Status.Allocatable["memory"], false),
			},
			MaxPods: int(resources.ParseMemoryBytes(node.Status.Capacity["pods"])), // reuse int parser
		}

		// Node status + pressure conditions
		overview.Status = resources.NodeStatus(node.Status.Conditions)
		overview.DiskPressure, overview.MemoryPressure, overview.PIDPressure = nodePressures(node.Status.Conditions)

		// Node info
		overview.KernelVersion = node.Status.NodeInfo.KernelVersion
		overview.OSImage = node.Status.NodeInfo.OSImage
		overview.Age = nodeAge(node.Metadata.CreationTimestamp)

		// Taints
		for _, t := range node.Spec.Taints {
			overview.Taints = append(overview.Taints, resources.NodeTaint{
				Key: t.Key, Value: t.Value, Effect: t.Effect,
			})
		}

		// Aggregated pod data
		if a := agg[node.Metadata.Name]; a != nil {
			overview.PodCount = a.podCount
			overview.Requested = resources.NodeResources{
				CPU:    resources.ResourceValue{Millicores: a.cpuReq, Raw: resources.FmtMillicores(a.cpuReq)},
				Memory: resources.ResourceValue{Bytes: a.memReq, Raw: resources.FmtBytes(a.memReq)},
			}
			overview.Limited = resources.NodeResources{
				CPU:    resources.ResourceValue{Millicores: a.cpuLim, Raw: resources.FmtMillicores(a.cpuLim)},
				Memory: resources.ResourceValue{Bytes: a.memLim, Raw: resources.FmtBytes(a.memLim)},
			}
		}

		// Node metrics usage
		if nm, ok := nodeMetrics[node.Metadata.Name]; ok {
			usage := &resources.NodeResources{
				CPU:    resources.ParseResource(nm.Usage["cpu"], true),
				Memory: resources.ParseResource(nm.Usage["memory"], false),
			}
			overview.Usage = usage
		}

		result = append(result, overview)
	}

	jsonOK(w, result)
}

// GetNodePods returns the list of non-terminal pods running on a given node,
// with per-container resource requests, limits, and live usage (best-effort).
func GetNodePods(w http.ResponseWriter, r *http.Request) {
	nodeName := chi.URLParam(r, "node")
	token := middleware.TokenFromContext(r.Context())
	client := k8s.New(token, middleware.ClusterURLFromContext(r.Context()))

	allPods, err := client.ListAllPods()
	if err != nil {
		log.Printf("failed to list pods for node %s: %v", nodeName, err)
		jsonError(w, "internal server error", http.StatusInternalServerError)
		return
	}

	// Pod metrics — cluster-wide, best-effort (not fatal if unavailable)
	// metricsMap: pod name -> container name -> usage
	metricsMap := map[string]map[string]k8s.ContainerUsage{}
	if pm, err := client.ListAllPodMetrics(); err == nil {
		for _, pm := range pm.Items {
			containers := make(map[string]k8s.ContainerUsage, len(pm.Containers))
			for _, c := range pm.Containers {
				containers[c.Name] = c
			}
			metricsMap[pm.Metadata.Name] = containers
		}
	}

	result := make([]resources.PodDetail, 0)
	for _, pod := range allPods.Items {
		if pod.Spec.NodeName != nodeName {
			continue
		}
		if pod.Status.Phase == "Succeeded" || pod.Status.Phase == "Failed" {
			continue
		}

		containerMetrics := metricsMap[pod.Metadata.Name]
		containers := make([]resources.ContainerResources, 0, len(pod.Spec.Containers))
		for _, c := range pod.Spec.Containers {
			cr := resources.ContainerResources{
				Name: c.Name,
				Requests: resources.ResourcePair{
					CPU:    resources.ParseResource(c.Resources.Requests["cpu"], true),
					Memory: resources.ParseResource(c.Resources.Requests["memory"], false),
				},
				Limits: resources.ResourcePair{
					CPU:    resources.ParseResource(c.Resources.Limits["cpu"], true),
					Memory: resources.ParseResource(c.Resources.Limits["memory"], false),
				},
			}
			if m, ok := containerMetrics[c.Name]; ok {
				cr.Usage = &resources.ResourcePair{
					CPU:    resources.ParseResource(m.Usage["cpu"], true),
					Memory: resources.ParseResource(m.Usage["memory"], false),
				}
			}
			containers = append(containers, cr)
		}

		result = append(result, resources.PodDetail{
			Name:       pod.Metadata.Name,
			Namespace:  pod.Metadata.Namespace,
			Phase:      pod.Status.Phase,
			Containers: containers,
		})
	}

	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	jsonOK(w, result)
}
