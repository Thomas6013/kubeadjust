package resources

import (
	"strings"

	"github.com/devops-kubeadjust/backend/k8s"
)

// NodeRoles extracts role names from node labels (node-role.kubernetes.io/<role>).
// Falls back to "worker" if no role labels are present.
func NodeRoles(labels map[string]string) []string {
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

// NodeStatus derives a human-readable status string from the node's Ready condition.
func NodeStatus(conditions []k8s.NodeCondition) string {
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
