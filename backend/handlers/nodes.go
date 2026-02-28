package handlers

import (
	"log"
	"net/http"

	"github.com/devops-kubeadjust/backend/k8s"
	"github.com/devops-kubeadjust/backend/middleware"
	"github.com/devops-kubeadjust/backend/resources"
)

// ListNodes returns a cluster-wide node overview with resource aggregation.
func ListNodes(w http.ResponseWriter, r *http.Request) {
	token := middleware.TokenFromContext(r.Context())
	client := k8s.New(token, "")

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

		// Node status from conditions
		overview.Status = resources.NodeStatus(node.Status.Conditions)

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
