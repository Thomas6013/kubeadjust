package k8s

// This file contains all Kubernetes API response types used by the K8s client.
// Keeping them separate from client.go makes the API surface easier to navigate.

// --- Common metadata ---

type ObjectMeta struct {
	Name              string            `json:"name"`
	Namespace         string            `json:"namespace"`
	Labels            map[string]string `json:"labels"`
	UID               string            `json:"uid"`
	OwnerReferences   []OwnerReference  `json:"ownerReferences,omitempty"`
	CreationTimestamp string            `json:"creationTimestamp,omitempty"`
}

type OwnerReference struct {
	APIVersion string `json:"apiVersion"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	UID        string `json:"uid"`
}

// --- Namespaces ---

type NamespaceList struct {
	Items []Namespace `json:"items"`
}
type Namespace struct {
	Metadata ObjectMeta `json:"metadata"`
}

// --- Deployments ---

type DeploymentList struct {
	Items []Deployment `json:"items"`
}
type Deployment struct {
	Metadata ObjectMeta `json:"metadata"`
	Spec     struct {
		Replicas int32 `json:"replicas"`
		Template struct {
			Spec PodSpec `json:"spec"`
		} `json:"template"`
	} `json:"spec"`
	Status struct {
		ReadyReplicas     int32 `json:"readyReplicas"`
		AvailableReplicas int32 `json:"availableReplicas"`
	} `json:"status"`
}

// --- ReplicaSets ---

type ReplicaSetList struct {
	Items []ReplicaSet `json:"items"`
}
type ReplicaSet struct {
	Metadata ObjectMeta `json:"metadata"`
}

// --- StatefulSets ---

type StatefulSetList struct {
	Items []StatefulSet `json:"items"`
}
type StatefulSet struct {
	Metadata ObjectMeta `json:"metadata"`
	Spec     struct {
		Replicas int32 `json:"replicas"`
	} `json:"spec"`
	Status struct {
		ReadyReplicas     int32 `json:"readyReplicas"`
		AvailableReplicas int32 `json:"availableReplicas"`
		CurrentReplicas   int32 `json:"currentReplicas"`
	} `json:"status"`
}

// --- Jobs / CronJobs ---

type JobList struct {
	Items []Job `json:"items"`
}
type Job struct {
	Metadata ObjectMeta `json:"metadata"`
	Status   struct {
		Active    int32 `json:"active"`
		Succeeded int32 `json:"succeeded"`
		Failed    int32 `json:"failed"`
	} `json:"status"`
}

type CronJobList struct {
	Items []CronJob `json:"items"`
}
type CronJob struct {
	Metadata ObjectMeta `json:"metadata"`
	Status   struct {
		Active []ObjectReference `json:"active,omitempty"`
	} `json:"status"`
}
type ObjectReference struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
}

// --- Pods ---

type PodList struct {
	Items []Pod `json:"items"`
}
type Pod struct {
	Metadata ObjectMeta `json:"metadata"`
	Spec     PodSpec    `json:"spec"`
	Status   struct {
		Phase             string            `json:"phase"`
		ContainerStatuses []ContainerStatus `json:"containerStatuses"`
	} `json:"status"`
}

type PodSpec struct {
	NodeName       string      `json:"nodeName"`
	Containers     []Container `json:"containers"`
	InitContainers []Container `json:"initContainers"`
	Volumes        []Volume    `json:"volumes"`
}

type Container struct {
	Name      string          `json:"name"`
	Resources ResourceRequire `json:"resources"`
}
type ResourceRequire struct {
	Requests map[string]string `json:"requests"`
	Limits   map[string]string `json:"limits"`
}
type ContainerStatus struct {
	Name  string `json:"name"`
	Ready bool   `json:"ready"`
}

// --- Volumes ---

type Volume struct {
	Name                  string                `json:"name"`
	PersistentVolumeClaim *PVCVolumeSource      `json:"persistentVolumeClaim"`
	EmptyDir              *EmptyDirVolumeSource `json:"emptyDir"`
}
type PVCVolumeSource struct {
	ClaimName string `json:"claimName"`
}
type EmptyDirVolumeSource struct {
	Medium    string `json:"medium"`    // "" = node disk, "Memory" = tmpfs
	SizeLimit string `json:"sizeLimit"` // "" if no limit
}

// --- PersistentVolumeClaims ---

type PVCList struct {
	Items []PVC `json:"items"`
}
type PVC struct {
	Metadata ObjectMeta `json:"metadata"`
	Spec     struct {
		StorageClassName string          `json:"storageClassName"`
		Resources        ResourceRequire `json:"resources"`
		AccessModes      []string        `json:"accessModes"`
	} `json:"spec"`
	Status struct {
		Phase    string            `json:"phase"`
		Capacity map[string]string `json:"capacity"`
	} `json:"status"`
}

// --- Kubelet summary API (stats/summary endpoint) ---

type NodeSummary struct {
	Pods []PodStatsSummary `json:"pods"`
}
type PodStatsSummary struct {
	PodRef     PodRef                  `json:"podRef"`
	Containers []ContainerStatsSummary `json:"containers"`
	Volumes    []VolumeStatsSummary    `json:"volume"`
}
type PodRef struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
}
type ContainerStatsSummary struct {
	Name   string     `json:"name"`
	Rootfs *StorageIO `json:"rootfs"`
	Logs   *StorageIO `json:"logs"`
}
type StorageIO struct {
	UsedBytes int64 `json:"usedBytes"`
}
type VolumeStatsSummary struct {
	Name           string  `json:"name"`
	PVCRef         *PVCRef `json:"pvcRef"`
	CapacityBytes  int64   `json:"capacityBytes"`
	UsedBytes      int64   `json:"usedBytes"`
	AvailableBytes int64   `json:"availableBytes"`
}
type PVCRef struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
}

// --- Nodes ---

type NodeList struct {
	Items []Node `json:"items"`
}
type NodeInfo struct {
	KubeletVersion string `json:"kubeletVersion"`
	KernelVersion  string `json:"kernelVersion"`
	OSImage        string `json:"osImage"`
}
type Node struct {
	Metadata ObjectMeta `json:"metadata"`
	Spec     struct {
		Taints []Taint `json:"taints,omitempty"`
	} `json:"spec"`
	Status struct {
		Capacity    map[string]string `json:"capacity"`
		Allocatable map[string]string `json:"allocatable"`
		Conditions  []NodeCondition   `json:"conditions"`
		NodeInfo    NodeInfo          `json:"nodeInfo"`
	} `json:"status"`
}
type NodeCondition struct {
	Type   string `json:"type"`
	Status string `json:"status"` // "True" | "False" | "Unknown"
}
type Taint struct {
	Key    string `json:"key"`
	Value  string `json:"value,omitempty"`
	Effect string `json:"effect"` // NoSchedule | PreferNoSchedule | NoExecute
}

// --- Metrics server ---

type NodeMetricsList struct {
	Items []NodeMetrics `json:"items"`
}
type NodeMetrics struct {
	Metadata ObjectMeta        `json:"metadata"`
	Usage    map[string]string `json:"usage"`
}

type PodMetricsList struct {
	Items []PodMetrics `json:"items"`
}
type PodMetrics struct {
	Metadata   ObjectMeta       `json:"metadata"`
	Containers []ContainerUsage `json:"containers"`
}
type ContainerUsage struct {
	Name  string            `json:"name"`
	Usage map[string]string `json:"usage"`
}
