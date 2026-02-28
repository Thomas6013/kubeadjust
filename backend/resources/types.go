package resources

import "github.com/devops-kubeadjust/backend/k8s"

// ResourceValue holds a parsed k8s resource quantity with the original raw string.
type ResourceValue struct {
	Raw        string `json:"raw"`
	Bytes      int64  `json:"bytes,omitempty"`
	Millicores int64  `json:"millicores,omitempty"`
}

type ResourcePair struct {
	CPU    ResourceValue `json:"cpu"`
	Memory ResourceValue `json:"memory"`
}

type EphemeralStorageInfo struct {
	Request *ResourceValue `json:"request"`
	Limit   *ResourceValue `json:"limit"`
	Usage   *ResourceValue `json:"usage"`
}

type VolumeDetail struct {
	Name         string         `json:"name"`
	Type         string         `json:"type"`
	Medium       string         `json:"medium,omitempty"`
	SizeLimit    *ResourceValue `json:"sizeLimit,omitempty"`
	PVCName      string         `json:"pvcName,omitempty"`
	StorageClass string         `json:"storageClass,omitempty"`
	AccessModes  []string       `json:"accessModes,omitempty"`
	Capacity     *ResourceValue `json:"capacity,omitempty"`
	Usage        *ResourceValue `json:"usage,omitempty"`
	Available    *ResourceValue `json:"available,omitempty"`
}

type ContainerResources struct {
	Name             string                `json:"name"`
	Requests         ResourcePair          `json:"requests"`
	Limits           ResourcePair          `json:"limits"`
	Usage            *ResourcePair         `json:"usage,omitempty"`
	EphemeralStorage *EphemeralStorageInfo `json:"ephemeralStorage,omitempty"`
}

type PodDetail struct {
	Name       string               `json:"name"`
	Phase      string               `json:"phase"`
	Containers []ContainerResources `json:"containers"`
	Volumes    []VolumeDetail       `json:"volumes,omitempty"`
}

type DeploymentDetail struct {
	Kind              string      `json:"kind"`
	Name              string      `json:"name"`
	Namespace         string      `json:"namespace"`
	Replicas          int32       `json:"replicas"`
	ReadyReplicas     int32       `json:"readyReplicas"`
	AvailableReplicas int32       `json:"availableReplicas"`
	Pods              []PodDetail `json:"pods"`
}

type WorkloadResponse struct {
	Workloads           []DeploymentDetail `json:"workloads"`
	MetricsAvailable    bool               `json:"metricsAvailable"`
	PrometheusAvailable bool               `json:"prometheusAvailable"`
}

type NodeResources struct {
	CPU    ResourceValue `json:"cpu"`
	Memory ResourceValue `json:"memory"`
}

type NodeOverview struct {
	Name        string         `json:"name"`
	Status      string         `json:"status"`
	Roles       []string       `json:"roles"`
	Capacity    NodeResources  `json:"capacity"`
	Allocatable NodeResources  `json:"allocatable"`
	Requested   NodeResources  `json:"requested"`
	Limited     NodeResources  `json:"limited"`
	Usage       *NodeResources `json:"usage"`
	PodCount    int            `json:"podCount"`
	MaxPods     int            `json:"maxPods"`
}

// PodStorageStats holds kubelet summary stats for a pod.
type PodStorageStats struct {
	ContainerEphemeral map[string]int64
	Volumes            map[string]k8s.VolumeStatsSummary
}

// WorkloadKey identifies a workload by kind and name.
type WorkloadKey struct {
	Kind string
	Name string
}
