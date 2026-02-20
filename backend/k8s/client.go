package k8s

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

const defaultAPIServer = "https://kubernetes.default.svc"

type Client struct {
	apiServer  string
	token      string
	httpClient *http.Client
}

func New(token, apiServer string) *Client {
	if apiServer == "" {
		apiServer = envOr("KUBE_API_SERVER", defaultAPIServer)
	}
	return &Client{
		apiServer: apiServer,
		token:     token,
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{
					InsecureSkipVerify: envOr("KUBE_INSECURE_TLS", "false") == "true",
				},
			},
		},
	}
}

func (c *Client) get(path string, out interface{}) error {
	req, err := http.NewRequest(http.MethodGet, c.apiServer+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("kubernetes api %s: %d %s", path, resp.StatusCode, string(body))
	}
	return json.Unmarshal(body, out)
}

func (c *Client) VerifyToken() error {
	var out json.RawMessage
	return c.get("/api", &out)
}

// --- Core types ---

type NamespaceList struct {
	Items []Namespace `json:"items"`
}
type Namespace struct {
	Metadata ObjectMeta `json:"metadata"`
}

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

// --- Volume types ---

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

// --- PVC types ---

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

// --- Kubelet summary API types ---

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

// --- Node types ---

type NodeList struct {
	Items []Node `json:"items"`
}
type Node struct {
	Metadata ObjectMeta `json:"metadata"`
	Status   struct {
		Capacity    map[string]string `json:"capacity"`
		Allocatable map[string]string `json:"allocatable"`
		Conditions  []NodeCondition   `json:"conditions"`
	} `json:"status"`
}
type NodeCondition struct {
	Type   string `json:"type"`
	Status string `json:"status"` // "True" | "False" | "Unknown"
}

// --- Metrics server ---

type NodeMetricsList struct {
	Items []NodeMetrics `json:"items"`
}
type NodeMetrics struct {
	Metadata ObjectMeta        `json:"metadata"`
	Usage    map[string]string `json:"usage"`
}

// ---

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

type ObjectMeta struct {
	Name      string            `json:"name"`
	Namespace string            `json:"namespace"`
	Labels    map[string]string `json:"labels"`
}

// --- API methods ---

func (c *Client) ListNamespaces() (*NamespaceList, error) {
	var out NamespaceList
	return &out, c.get("/api/v1/namespaces", &out)
}

func (c *Client) ListDeployments(namespace string) (*DeploymentList, error) {
	var out DeploymentList
	return &out, c.get(fmt.Sprintf("/apis/apps/v1/namespaces/%s/deployments", namespace), &out)
}

func (c *Client) ListPods(namespace string) (*PodList, error) {
	var out PodList
	return &out, c.get(fmt.Sprintf("/api/v1/namespaces/%s/pods", namespace), &out)
}

func (c *Client) ListPodMetrics(namespace string) (*PodMetricsList, error) {
	var out PodMetricsList
	return &out, c.get(fmt.Sprintf("/apis/metrics.k8s.io/v1beta1/namespaces/%s/pods", namespace), &out)
}

func (c *Client) ListNodes() (*NodeList, error) {
	var out NodeList
	return &out, c.get("/api/v1/nodes", &out)
}

func (c *Client) ListNodeMetrics() (*NodeMetricsList, error) {
	var out NodeMetricsList
	return &out, c.get("/apis/metrics.k8s.io/v1beta1/nodes", &out)
}

// ListAllPods lists pods across all namespaces (needed for node aggregation).
func (c *Client) ListAllPods() (*PodList, error) {
	var out PodList
	return &out, c.get("/api/v1/pods", &out)
}

func (c *Client) ListPVCs(namespace string) (*PVCList, error) {
	var out PVCList
	return &out, c.get(fmt.Sprintf("/api/v1/namespaces/%s/persistentvolumeclaims", namespace), &out)
}

// GetNodeSummary calls the kubelet stats/summary via the API server proxy.
// Requires nodes/proxy get permission. Best-effort: caller should handle errors.
func (c *Client) GetNodeSummary(nodeName string) (*NodeSummary, error) {
	var out NodeSummary
	return &out, c.get(fmt.Sprintf("/api/v1/nodes/%s/proxy/stats/summary", nodeName), &out)
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
