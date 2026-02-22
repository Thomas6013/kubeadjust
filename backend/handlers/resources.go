package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/devops-kubeadjust/backend/k8s"
	"github.com/devops-kubeadjust/backend/middleware"
)

// --- Response types ---

type ResourceValue struct {
	Raw   string `json:"raw"`
	Bytes int64  `json:"bytes,omitempty"`
	Millicores int64 `json:"millicores,omitempty"`
}

type ResourcePair struct {
	CPU    ResourceValue `json:"cpu"`
	Memory ResourceValue `json:"memory"`
}

type EphemeralStorageInfo struct {
	Request *ResourceValue `json:"request"` // nil = not set in spec
	Limit   *ResourceValue `json:"limit"`   // nil = not set (unlimited)
	Usage   *ResourceValue `json:"usage"`   // nil = kubelet unavailable
}

type VolumeDetail struct {
	Name         string         `json:"name"`
	Type         string         `json:"type"`                  // "pvc" | "emptyDir" | "other"
	Medium       string         `json:"medium,omitempty"`      // emptyDir: "" or "Memory"
	SizeLimit    *ResourceValue `json:"sizeLimit,omitempty"`   // emptyDir explicit limit
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
	Name              string      `json:"name"`
	Namespace         string      `json:"namespace"`
	Replicas          int32       `json:"replicas"`
	ReadyReplicas     int32       `json:"readyReplicas"`
	AvailableReplicas int32       `json:"availableReplicas"`
	Pods              []PodDetail `json:"pods"`
}

// --- storage lookup maps built from kubelet summary ---

type podStorageStats struct {
	// container name → ephemeral bytes (rootfs + logs)
	containerEphemeral map[string]int64
	// volume name → stats
	volumes map[string]k8s.VolumeStatsSummary
}

// --- Handler ---

func ListDeployments(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	token := middleware.TokenFromContext(r.Context())
	client := k8s.New(token, "")

	// 1. Fetch pods once (not per deployment)
	podList, err := client.ListPods(ns)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// 2. Fetch deployments
	deployments, err := client.ListDeployments(ns)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// 3. Fetch CPU/memory metrics (best-effort)
	metricsMap := map[string]map[string]k8s.ContainerUsage{} // podName → containerName → usage
	if metrics, err := client.ListPodMetrics(ns); err == nil {
		for _, pm := range metrics.Items {
			m := map[string]k8s.ContainerUsage{}
			for _, cu := range pm.Containers {
				m[cu.Name] = cu
			}
			metricsMap[pm.Metadata.Name] = m
		}
	}

	// 4. Fetch node summaries (deduplicated, best-effort) for storage stats
	nodeNames := map[string]struct{}{}
	for _, pod := range podList.Items {
		if pod.Spec.NodeName != "" {
			nodeNames[pod.Spec.NodeName] = struct{}{}
		}
	}
	// podName → storage stats
	podStorageMap := map[string]podStorageStats{}
	for node := range nodeNames {
		summary, err := client.GetNodeSummary(node)
		if err != nil {
			continue // not fatal — RBAC may forbid it
		}
		for _, ps := range summary.Pods {
			if ps.PodRef.Namespace != ns {
				continue
			}
			stats := podStorageStats{
				containerEphemeral: map[string]int64{},
				volumes:            map[string]k8s.VolumeStatsSummary{},
			}
			for _, cs := range ps.Containers {
				var used int64
				if cs.Rootfs != nil {
					used += cs.Rootfs.UsedBytes
				}
				if cs.Logs != nil {
					used += cs.Logs.UsedBytes
				}
				stats.containerEphemeral[cs.Name] = used
			}
			for _, vs := range ps.Volumes {
				stats.volumes[vs.Name] = vs
			}
			podStorageMap[ps.PodRef.Name] = stats
		}
	}

	// 5. Fetch PVCs (best-effort)
	pvcMap := map[string]k8s.PVC{} // claimName → PVC
	if pvcs, err := client.ListPVCs(ns); err == nil {
		for _, pvc := range pvcs.Items {
			pvcMap[pvc.Metadata.Name] = pvc
		}
	}

	// 6. Build response
	result := make([]DeploymentDetail, 0, len(deployments.Items))
	for _, dep := range deployments.Items {
		var pods []PodDetail
		for _, pod := range podList.Items {
			if !belongsToDeployment(pod, dep.Metadata.Name) {
				continue
			}
			stoStats := podStorageMap[pod.Metadata.Name]

			// Containers
			var containers []ContainerResources
			for _, c := range pod.Spec.Containers {
				cr := ContainerResources{
					Name: c.Name,
					Requests: ResourcePair{
						CPU:    parseResource(c.Resources.Requests["cpu"], true),
						Memory: parseResource(c.Resources.Requests["memory"], false),
					},
					Limits: ResourcePair{
						CPU:    parseResource(c.Resources.Limits["cpu"], true),
						Memory: parseResource(c.Resources.Limits["memory"], false),
					},
				}
				// CPU/mem usage from metrics-server
				if podMetrics, ok := metricsMap[pod.Metadata.Name]; ok {
					if cu, ok := podMetrics[c.Name]; ok {
						cr.Usage = &ResourcePair{
							CPU:    parseResource(cu.Usage["cpu"], true),
							Memory: parseResource(cu.Usage["memory"], false),
						}
					}
				}
				// Ephemeral storage
				ephInfo := &EphemeralStorageInfo{}
				if reqRaw := c.Resources.Requests["ephemeral-storage"]; reqRaw != "" {
					v := parseStorageBytes(reqRaw)
					ephInfo.Request = &v
				}
				if limRaw := c.Resources.Limits["ephemeral-storage"]; limRaw != "" {
					v := parseStorageBytes(limRaw)
					ephInfo.Limit = &v
				}
				if stoStats.containerEphemeral != nil {
					if used, ok := stoStats.containerEphemeral[c.Name]; ok {
						v := ResourceValue{Bytes: used, Raw: fmtBytes(used)}
						ephInfo.Usage = &v
					}
				}
				cr.EphemeralStorage = ephInfo
				containers = append(containers, cr)
			}

			// Volumes
			var volumes []VolumeDetail
			for _, vol := range pod.Spec.Volumes {
				switch {
				case vol.PersistentVolumeClaim != nil:
					vd := VolumeDetail{
						Name:    vol.Name,
						Type:    "pvc",
						PVCName: vol.PersistentVolumeClaim.ClaimName,
					}
					if pvc, ok := pvcMap[vol.PersistentVolumeClaim.ClaimName]; ok {
						vd.StorageClass = pvc.Spec.StorageClassName
						vd.AccessModes = pvc.Spec.AccessModes
						if cap, ok := pvc.Status.Capacity["storage"]; ok {
							v := parseStorageBytes(cap)
							vd.Capacity = &v
						}
					}
					if stoStats.volumes != nil {
						if vs, ok := stoStats.volumes[vol.Name]; ok {
							u := ResourceValue{Bytes: vs.UsedBytes, Raw: fmtBytes(vs.UsedBytes)}
							a := ResourceValue{Bytes: vs.AvailableBytes, Raw: fmtBytes(vs.AvailableBytes)}
							vd.Usage = &u
							vd.Available = &a
						}
					}
					volumes = append(volumes, vd)

				case vol.EmptyDir != nil:
					vd := VolumeDetail{
						Name:   vol.Name,
						Type:   "emptyDir",
						Medium: vol.EmptyDir.Medium,
					}
					if vol.EmptyDir.SizeLimit != "" {
						v := parseStorageBytes(vol.EmptyDir.SizeLimit)
						vd.SizeLimit = &v
					}
					if stoStats.volumes != nil {
						if vs, ok := stoStats.volumes[vol.Name]; ok {
							u := ResourceValue{Bytes: vs.UsedBytes, Raw: fmtBytes(vs.UsedBytes)}
							vd.Usage = &u
							if vs.CapacityBytes > 0 {
								c := ResourceValue{Bytes: vs.CapacityBytes, Raw: fmtBytes(vs.CapacityBytes)}
								vd.Capacity = &c
							}
						}
					}
					volumes = append(volumes, vd)
				}
			}

			pods = append(pods, PodDetail{
				Name:       pod.Metadata.Name,
				Phase:      pod.Status.Phase,
				Containers: containers,
				Volumes:    volumes,
			})
		}

		result = append(result, DeploymentDetail{
			Name:              dep.Metadata.Name,
			Namespace:         dep.Metadata.Namespace,
			Replicas:          dep.Spec.Replicas,
			ReadyReplicas:     dep.Status.ReadyReplicas,
			AvailableReplicas: dep.Status.AvailableReplicas,
			Pods:              pods,
		})
	}

	jsonOK(w, result)
}

func belongsToDeployment(pod k8s.Pod, deployName string) bool {
	return strings.HasPrefix(pod.Metadata.Name, deployName+"-")
}

// --- Resource parsing ---

func parseResource(raw string, isCPU bool) ResourceValue {
	if raw == "" {
		return ResourceValue{Raw: ""}
	}
	rv := ResourceValue{Raw: raw}
	if isCPU {
		rv.Millicores = parseCPUMillicores(raw)
	} else {
		rv.Bytes = parseMemoryBytes(raw)
	}
	return rv
}

func parseStorageBytes(raw string) ResourceValue {
	if raw == "" {
		return ResourceValue{}
	}
	b := parseMemoryBytes(raw)
	return ResourceValue{Raw: raw, Bytes: b}
}

func parseCPUMillicores(s string) int64 {
	if strings.HasSuffix(s, "m") {
		v, _ := strconv.ParseInt(strings.TrimSuffix(s, "m"), 10, 64)
		return v
	}
	v, _ := strconv.ParseFloat(s, 64)
	return int64(v * 1000)
}

func parseMemoryBytes(s string) int64 {
	suffixes := []struct {
		suffix string
		factor int64
	}{
		{"Ki", 1024},
		{"Mi", 1024 * 1024},
		{"Gi", 1024 * 1024 * 1024},
		{"Ti", 1024 * 1024 * 1024 * 1024},
		{"K", 1000},
		{"M", 1000 * 1000},
		{"G", 1000 * 1000 * 1000},
		{"T", 1000 * 1000 * 1000 * 1000},
	}
	for _, sf := range suffixes {
		if strings.HasSuffix(s, sf.suffix) {
			v, _ := strconv.ParseInt(strings.TrimSuffix(s, sf.suffix), 10, 64)
			return v * sf.factor
		}
	}
	if strings.HasSuffix(s, "n") {
		v, _ := strconv.ParseInt(strings.TrimSuffix(s, "n"), 10, 64)
		return v / 1_000_000_000
	}
	v, _ := strconv.ParseInt(s, 10, 64)
	return v
}

func fmtBytes(b int64) string {
	const gib = 1024 * 1024 * 1024
	const mib = 1024 * 1024
	const kib = 1024
	switch {
	case b >= gib:
		return fmt.Sprintf("%.2f Gi", float64(b)/float64(gib))
	case b >= mib:
		return fmt.Sprintf("%d Mi", b/mib)
	case b >= kib:
		return fmt.Sprintf("%d Ki", b/kib)
	default:
		return fmt.Sprintf("%d B", b)
	}
}

func GetPodMetrics(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	client := k8s.New(middleware.TokenFromContext(r.Context()), "")
	metrics, err := client.ListPodMetrics(ns)
	if err != nil {
		jsonError(w, fmt.Sprintf("metrics-server unavailable: %s", err.Error()), http.StatusServiceUnavailable)
		return
	}
	jsonOK(w, metrics)
}
