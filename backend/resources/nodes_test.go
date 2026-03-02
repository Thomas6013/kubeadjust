package resources

import (
	"sort"
	"testing"

	"github.com/devops-kubeadjust/backend/k8s"
)

func TestNodeRoles(t *testing.T) {
	tests := []struct {
		name   string
		labels map[string]string
		want   []string
	}{
		{
			name:   "no role labels → worker fallback",
			labels: map[string]string{"kubernetes.io/os": "linux"},
			want:   []string{"worker"},
		},
		{
			name:   "nil labels → worker fallback",
			labels: nil,
			want:   []string{"worker"},
		},
		{
			name:   "empty map → worker fallback",
			labels: map[string]string{},
			want:   []string{"worker"},
		},
		{
			name:   "control-plane role",
			labels: map[string]string{"node-role.kubernetes.io/control-plane": ""},
			want:   []string{"control-plane"},
		},
		{
			name: "multiple roles",
			labels: map[string]string{
				"node-role.kubernetes.io/control-plane": "",
				"node-role.kubernetes.io/etcd":          "",
			},
			want: []string{"control-plane", "etcd"},
		},
		{
			name:   "empty suffix ignored → worker fallback",
			labels: map[string]string{"node-role.kubernetes.io/": ""},
			want:   []string{"worker"},
		},
		{
			name: "non-role labels do not count",
			labels: map[string]string{
				"kubernetes.io/hostname": "node1",
				"beta.kubernetes.io/os": "linux",
			},
			want: []string{"worker"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NodeRoles(tt.labels)
			sort.Strings(got)
			sort.Strings(tt.want)
			if len(got) != len(tt.want) {
				t.Fatalf("NodeRoles() = %v, want %v", got, tt.want)
			}
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("NodeRoles()[%d] = %q, want %q", i, got[i], tt.want[i])
				}
			}
		})
	}
}

func TestNodeStatus(t *testing.T) {
	tests := []struct {
		name       string
		conditions []k8s.NodeCondition
		want       string
	}{
		{
			name:       "no conditions → Unknown",
			conditions: nil,
			want:       "Unknown",
		},
		{
			name:       "empty conditions → Unknown",
			conditions: []k8s.NodeCondition{},
			want:       "Unknown",
		},
		{
			name:       "no Ready condition → Unknown",
			conditions: []k8s.NodeCondition{{Type: "DiskPressure", Status: "False"}},
			want:       "Unknown",
		},
		{
			name:       "Ready = True",
			conditions: []k8s.NodeCondition{{Type: "Ready", Status: "True"}},
			want:       "Ready",
		},
		{
			name:       "Ready = False",
			conditions: []k8s.NodeCondition{{Type: "Ready", Status: "False"}},
			want:       "NotReady",
		},
		{
			name:       "Ready = Unknown",
			conditions: []k8s.NodeCondition{{Type: "Ready", Status: "Unknown"}},
			want:       "Unknown",
		},
		{
			name:       "Ready = unexpected value → Unknown",
			conditions: []k8s.NodeCondition{{Type: "Ready", Status: ""}},
			want:       "Unknown",
		},
		{
			name: "Ready condition among others",
			conditions: []k8s.NodeCondition{
				{Type: "DiskPressure", Status: "False"},
				{Type: "Ready", Status: "True"},
				{Type: "MemoryPressure", Status: "False"},
			},
			want: "Ready",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NodeStatus(tt.conditions)
			if got != tt.want {
				t.Errorf("NodeStatus() = %q, want %q", got, tt.want)
			}
		})
	}
}
