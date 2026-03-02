package resources

import (
	"testing"

	"github.com/devops-kubeadjust/backend/k8s"
)

// --- BuildOwnerMaps ---

func TestBuildOwnerMaps(t *testing.T) {
	t.Run("pod owned by ReplicaSet → Deployment", func(t *testing.T) {
		pods := []k8s.Pod{{
			Metadata: k8s.ObjectMeta{
				Name: "web-abc",
				OwnerReferences: []k8s.OwnerReference{{Kind: "ReplicaSet", Name: "web-rs"}},
			},
		}}
		rsList := &k8s.ReplicaSetList{Items: []k8s.ReplicaSet{{
			Metadata: k8s.ObjectMeta{
				Name:            "web-rs",
				OwnerReferences: []k8s.OwnerReference{{Kind: "Deployment", Name: "web"}},
			},
		}}}
		result := BuildOwnerMaps(pods, rsList, nil)
		if result["web-abc"] != (WorkloadKey{Kind: "Deployment", Name: "web"}) {
			t.Errorf("expected Deployment/web, got %+v", result["web-abc"])
		}
	})

	t.Run("pod owned by StatefulSet", func(t *testing.T) {
		pods := []k8s.Pod{{
			Metadata: k8s.ObjectMeta{
				Name:            "db-0",
				OwnerReferences: []k8s.OwnerReference{{Kind: "StatefulSet", Name: "db"}},
			},
		}}
		result := BuildOwnerMaps(pods, nil, nil)
		if result["db-0"] != (WorkloadKey{Kind: "StatefulSet", Name: "db"}) {
			t.Errorf("expected StatefulSet/db, got %+v", result["db-0"])
		}
	})

	t.Run("pod owned by Job → CronJob", func(t *testing.T) {
		pods := []k8s.Pod{{
			Metadata: k8s.ObjectMeta{
				Name:            "backup-job-xyz",
				OwnerReferences: []k8s.OwnerReference{{Kind: "Job", Name: "backup-job"}},
			},
		}}
		jobs := &k8s.JobList{Items: []k8s.Job{{
			Metadata: k8s.ObjectMeta{
				Name:            "backup-job",
				OwnerReferences: []k8s.OwnerReference{{Kind: "CronJob", Name: "backup"}},
			},
		}}}
		result := BuildOwnerMaps(pods, nil, jobs)
		if result["backup-job-xyz"] != (WorkloadKey{Kind: "CronJob", Name: "backup"}) {
			t.Errorf("expected CronJob/backup, got %+v", result["backup-job-xyz"])
		}
	})

	t.Run("pod with no owner → not in map", func(t *testing.T) {
		pods := []k8s.Pod{{
			Metadata: k8s.ObjectMeta{Name: "standalone"},
		}}
		result := BuildOwnerMaps(pods, nil, nil)
		if _, ok := result["standalone"]; ok {
			t.Error("expected standalone pod to not appear in owner map")
		}
	})

	t.Run("unresolved ReplicaSet → pod not in map", func(t *testing.T) {
		pods := []k8s.Pod{{
			Metadata: k8s.ObjectMeta{
				Name:            "orphan-pod",
				OwnerReferences: []k8s.OwnerReference{{Kind: "ReplicaSet", Name: "missing-rs"}},
			},
		}}
		result := BuildOwnerMaps(pods, &k8s.ReplicaSetList{}, nil)
		if _, ok := result["orphan-pod"]; ok {
			t.Error("expected orphan pod (unresolved RS) to not appear in owner map")
		}
	})
}

// --- BuildPodDetails ---

func pod(name, phase string, containers ...k8s.Container) k8s.Pod {
	return k8s.Pod{
		Metadata: k8s.ObjectMeta{Name: name},
		Spec:     k8s.PodSpec{Containers: containers},
		Status:   struct {
			Phase             string            `json:"phase"`
			ContainerStatuses []k8s.ContainerStatus `json:"containerStatuses"`
		}{Phase: phase},
	}
}

func container(name string, cpuReq, memReq, cpuLim, memLim string) k8s.Container {
	return k8s.Container{
		Name: name,
		Resources: k8s.ResourceRequire{
			Requests: map[string]string{"cpu": cpuReq, "memory": memReq},
			Limits:   map[string]string{"cpu": cpuLim, "memory": memLim},
		},
	}
}

func TestBuildPodDetails(t *testing.T) {
	t.Run("basic requests and limits parsed", func(t *testing.T) {
		pods := []k8s.Pod{pod("app-1", "Running",
			container("app", "500m", "128Mi", "1", "256Mi"),
		)}
		result := BuildPodDetails(pods, nil, nil, nil)
		if len(result) != 1 {
			t.Fatalf("expected 1 pod, got %d", len(result))
		}
		c := result[0].Containers[0]
		if c.Requests.CPU.Millicores != 500 {
			t.Errorf("cpu request: got %d, want 500", c.Requests.CPU.Millicores)
		}
		if c.Requests.Memory.Bytes != 128*1024*1024 {
			t.Errorf("memory request: got %d, want %d", c.Requests.Memory.Bytes, 128*1024*1024)
		}
		if c.Limits.CPU.Millicores != 1000 {
			t.Errorf("cpu limit: got %d, want 1000", c.Limits.CPU.Millicores)
		}
		if c.Limits.Memory.Bytes != 256*1024*1024 {
			t.Errorf("memory limit: got %d, want %d", c.Limits.Memory.Bytes, 256*1024*1024)
		}
	})

	t.Run("usage populated from metricsMap", func(t *testing.T) {
		pods := []k8s.Pod{pod("app-1", "Running",
			container("app", "500m", "128Mi", "1", "256Mi"),
		)}
		metricsMap := map[string]map[string]k8s.ContainerUsage{
			"app-1": {
				"app": {Name: "app", Usage: map[string]string{"cpu": "250m", "memory": "64Mi"}},
			},
		}
		result := BuildPodDetails(pods, metricsMap, nil, nil)
		c := result[0].Containers[0]
		if c.Usage == nil {
			t.Fatal("expected usage to be populated")
		}
		if c.Usage.CPU.Millicores != 250 {
			t.Errorf("cpu usage: got %d, want 250", c.Usage.CPU.Millicores)
		}
		if c.Usage.Memory.Bytes != 64*1024*1024 {
			t.Errorf("memory usage: got %d, want %d", c.Usage.Memory.Bytes, 64*1024*1024)
		}
	})

	t.Run("no usage when pod not in metricsMap", func(t *testing.T) {
		pods := []k8s.Pod{pod("app-1", "Running", container("app", "500m", "128Mi", "", ""))}
		result := BuildPodDetails(pods, map[string]map[string]k8s.ContainerUsage{}, nil, nil)
		if result[0].Containers[0].Usage != nil {
			t.Error("expected nil usage when pod not in metricsMap")
		}
	})

	t.Run("empty pod list returns empty slice", func(t *testing.T) {
		result := BuildPodDetails(nil, nil, nil, nil)
		if len(result) != 0 {
			t.Errorf("expected 0 results, got %d", len(result))
		}
	})

	t.Run("phase preserved", func(t *testing.T) {
		pods := []k8s.Pod{pod("p1", "Pending", container("c", "", "", "", ""))}
		result := BuildPodDetails(pods, nil, nil, nil)
		if result[0].Phase != "Pending" {
			t.Errorf("phase: got %q, want %q", result[0].Phase, "Pending")
		}
	})
}
