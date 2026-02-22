package handlers

import (
	"net/http"
	"strings"

	"github.com/devops-kubeadjust/backend/k8s"
	"github.com/devops-kubeadjust/backend/middleware"
)

// --- Response types ---

type NodeResources struct {
	CPU    ResourceValue `json:"cpu"`
	Memory ResourceValue `json:"memory"`
}

type NodeOverview struct {
	Name        string         `json:"name"`
	Status      string         `json:"status"` // "Ready" | "NotReady" | "Unknown"
	Roles       []string       `json:"roles"`
	Capacity    NodeResources  `json:"capacity"`
	Allocatable NodeResources  `json:"allocatable"`
	Requested   NodeResources  `json:"requested"`  // sum of pod requests on this node
	Limited     NodeResources  `json:"limited"`    // sum of pod limits
	Usage       *NodeResources `json:"usage"`      // from metrics-server, nil if unavailable
	PodCount    int            `json:"podCount"`
	MaxPods     int            `json:"maxPods"`
}

// ListNodes returns a cluster-wide node overview with resource aggregation.
func ListNodes(w http.ResponseWriter, r *http.Request) {
	token := middleware.TokenFromContext(r.Context())
	client := k8s.New(token, "")

	nodes, err := client.ListNodes()
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// All pods across namespaces for request/limit aggregation per node
	allPods, err := client.ListAllPods()
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
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
			agg[node].cpuReq += parseCPUMillicores(c.Resources.Requests["cpu"])
			agg[node].memReq += parseMemoryBytes(c.Resources.Requests["memory"])
			agg[node].cpuLim += parseCPUMillicores(c.Resources.Limits["cpu"])
			agg[node].memLim += parseMemoryBytes(c.Resources.Limits["memory"])
		}
	}

	result := make([]NodeOverview, 0, len(nodes.Items))
	for _, node := range nodes.Items {
		overview := NodeOverview{
			Name:  node.Metadata.Name,
			Roles: nodeRoles(node.Metadata.Labels),
			Capacity: NodeResources{
				CPU:    parseResource(node.Status.Capacity["cpu"], true),
				Memory: parseResource(node.Status.Capacity["memory"], false),
			},
			Allocatable: NodeResources{
				CPU:    parseResource(node.Status.Allocatable["cpu"], true),
				Memory: parseResource(node.Status.Allocatable["memory"], false),
			},
			MaxPods: int(parseMemoryBytes(node.Status.Capacity["pods"])), // reuse int parser
		}

		// Node status from conditions
		overview.Status = nodeStatus(node.Status.Conditions)

		// Aggregated pod data
		if a := agg[node.Metadata.Name]; a != nil {
			overview.PodCount = a.podCount
			overview.Requested = NodeResources{
				CPU:    ResourceValue{Millicores: a.cpuReq, Raw: fmtBytes(a.cpuReq) + "m"},
				Memory: ResourceValue{Bytes: a.memReq, Raw: fmtBytes(a.memReq)},
			}
			overview.Limited = NodeResources{
				CPU:    ResourceValue{Millicores: a.cpuLim, Raw: fmtBytes(a.cpuLim) + "m"},
				Memory: ResourceValue{Bytes: a.memLim, Raw: fmtBytes(a.memLim)},
			}
		}

		// Node metrics usage
		if nm, ok := nodeMetrics[node.Metadata.Name]; ok {
			usage := &NodeResources{
				CPU:    parseResource(nm.Usage["cpu"], true),
				Memory: parseResource(nm.Usage["memory"], false),
			}
			overview.Usage = usage
		}

		result = append(result, overview)
	}

	jsonOK(w, result)
}

func nodeRoles(labels map[string]string) []string {
	roles := []string{}
	for k := range labels {
		if strings.HasPrefix(k, "node-role.kubernetes.io/") {
			role := strings.TrimPrefix(k, "node-role.kubernetes.io/")
			if role != "" {
				roles = append(roles, role)
			}
		}
	}
	if len(roles) == 0 {
		roles = append(roles, "worker")
	}
	return roles
}

func nodeStatus(conditions []k8s.NodeCondition) string {
	for _, c := range conditions {
		if c.Type == "Ready" {
			switch c.Status {
			case "True":
				return "Ready"
			case "False":
				return "NotReady"
			default:
				return "Unknown"
			}
		}
	}
	return "Unknown"
}
