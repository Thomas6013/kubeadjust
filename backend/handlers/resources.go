package handlers

import (
	"fmt"
	"net/http"
	"os"
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
	Kind              string      `json:"kind"` // "Deployment" | "StatefulSet" | "CronJob"
	Name              string      `json:"name"`
	Namespace         string      `json:"namespace"`
	Replicas          int32       `json:"replicas"`
	ReadyReplicas     int32       `json:"readyReplicas"`
	AvailableReplicas int32       `json:"availableReplicas"`
	Pods              []PodDetail `json:"pods"`
}

// WorkloadResponse wraps the workloads list with availability flags.
type WorkloadResponse struct {
	Workloads          []DeploymentDetail `json:"workloads"`
	MetricsAvailable   bool               `json:"metricsAvailable"`
	PrometheusAvailable bool              `json:"prometheusAvailable"`
}

// isMetricsServerUnavailable returns true when the error indicates metrics-server
// is not installed (as opposed to an RBAC or transient error).
func isMetricsServerUnavailable(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	return strings.Contains(s, "404") ||
		strings.Contains(s, "503") ||
		strings.Contains(s, "no kind is registered") ||
		strings.Contains(s, "could not find the requested resource")
}

// --- storage lookup maps built from kubelet summary ---

type podStorageStats struct {
	// container name → ephemeral bytes (rootfs + logs)
	containerEphemeral map[string]int64
	// volume name → stats
	volumes map[string]k8s.VolumeStatsSummary
}

// --- Handler ---

// workloadKey identifies a workload by kind and name.
type workloadKey struct {
	kind string
	name string
}

// buildOwnerMaps resolves pod → workload ownership using OwnerReferences.
// Returns a map of podName → workloadKey.
func buildOwnerMaps(pods []k8s.Pod, rsList *k8s.ReplicaSetList, jobs *k8s.JobList) map[string]workloadKey {
	rsToDeployment := map[string]string{}
	if rsList != nil {
		for _, rs := range rsList.Items {
			for _, ref := range rs.Metadata.OwnerReferences {
				if ref.Kind == "Deployment" {
					rsToDeployment[rs.Metadata.Name] = ref.Name
				}
			}
		}
	}
	jobToCronJob := map[string]string{}
	if jobs != nil {
		for _, job := range jobs.Items {
			for _, ref := range job.Metadata.OwnerReferences {
				if ref.Kind == "CronJob" {
					jobToCronJob[job.Metadata.Name] = ref.Name
				}
			}
		}
	}
	podToWorkload := map[string]workloadKey{}
	for _, pod := range pods {
		for _, ref := range pod.Metadata.OwnerReferences {
			switch ref.Kind {
			case "ReplicaSet":
				if depName, ok := rsToDeployment[ref.Name]; ok {
					podToWorkload[pod.Metadata.Name] = workloadKey{"Deployment", depName}
				}
			case "StatefulSet":
				podToWorkload[pod.Metadata.Name] = workloadKey{"StatefulSet", ref.Name}
			case "Job":
				if cronName, ok := jobToCronJob[ref.Name]; ok {
					podToWorkload[pod.Metadata.Name] = workloadKey{"CronJob", cronName}
				}
			}
		}
	}
	return podToWorkload
}

// ListDeployments fetches all workloads (Deployments, StatefulSets, CronJobs) in a namespace
// along with per-container CPU/memory metrics, ephemeral storage, and PVC details.
func ListDeployments(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	token := middleware.TokenFromContext(r.Context())
	client := k8s.New(token, "")

	// 1. Fetch pods once
	podList, err := client.ListPods(ns)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// 2. Fetch workload types (deployments required; others best-effort)
	deployments, err := client.ListDeployments(ns)
	if err != nil {
		jsonError(w, err.Error(), http.StatusInternalServerError)
		return
	}
	var statefulSets *k8s.StatefulSetList
	if ss, err := client.ListStatefulSets(ns); err == nil {
		statefulSets = ss
	}
	var cronJobs *k8s.CronJobList
	if cj, err := client.ListCronJobs(ns); err == nil {
		cronJobs = cj
	}

	// 3. Fetch ReplicaSets and Jobs for owner resolution (best-effort)
	var rsList *k8s.ReplicaSetList
	if rs, err := client.ListReplicaSets(ns); err == nil {
		rsList = rs
	}
	var jobs *k8s.JobList
	if jl, err := client.ListJobs(ns); err == nil {
		jobs = jl
	}

	// 4. Build pod → workload ownership map
	podToWorkload := buildOwnerMaps(podList.Items, rsList, jobs)

	// 5. Fetch CPU/memory metrics (best-effort, track availability)
	metricsMap := map[string]map[string]k8s.ContainerUsage{}
	metricsAvailable := true
	if metrics, metricsErr := client.ListPodMetrics(ns); metricsErr != nil {
		if isMetricsServerUnavailable(metricsErr) {
			metricsAvailable = false
		}
	} else {
		for _, pm := range metrics.Items {
			m := map[string]k8s.ContainerUsage{}
			for _, cu := range pm.Containers {
				m[cu.Name] = cu
			}
			metricsMap[pm.Metadata.Name] = m
		}
	}

	// 6. Fetch node summaries for storage stats (best-effort)
	nodeNames := map[string]struct{}{}
	for _, pod := range podList.Items {
		if pod.Spec.NodeName != "" {
			nodeNames[pod.Spec.NodeName] = struct{}{}
		}
	}
	podStorageMap := map[string]podStorageStats{}
	for node := range nodeNames {
		summary, err := client.GetNodeSummary(node)
		if err != nil {
			continue
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

	// 7. Fetch PVCs (best-effort)
	pvcMap := map[string]k8s.PVC{}
	if pvcs, err := client.ListPVCs(ns); err == nil {
		for _, pvc := range pvcs.Items {
			pvcMap[pvc.Metadata.Name] = pvc
		}
	}

	// 8. Group pods by workload
	podsByWorkload := map[workloadKey][]k8s.Pod{}
	for _, pod := range podList.Items {
		if wk, ok := podToWorkload[pod.Metadata.Name]; ok {
			podsByWorkload[wk] = append(podsByWorkload[wk], pod)
		}
	}

	// 9. Build response — Deployments, StatefulSets, CronJobs
	var result []DeploymentDetail

	for _, dep := range deployments.Items {
		wk := workloadKey{"Deployment", dep.Metadata.Name}
		pods := buildPodDetails(podsByWorkload[wk], metricsMap, podStorageMap, pvcMap)
		result = append(result, DeploymentDetail{
			Kind:              "Deployment",
			Name:              dep.Metadata.Name,
			Namespace:         dep.Metadata.Namespace,
			Replicas:          dep.Spec.Replicas,
			ReadyReplicas:     dep.Status.ReadyReplicas,
			AvailableReplicas: dep.Status.AvailableReplicas,
			Pods:              pods,
		})
	}

	if statefulSets != nil {
		for _, ss := range statefulSets.Items {
			wk := workloadKey{"StatefulSet", ss.Metadata.Name}
			pods := buildPodDetails(podsByWorkload[wk], metricsMap, podStorageMap, pvcMap)
			avail := ss.Status.AvailableReplicas
			if avail == 0 {
				avail = ss.Status.CurrentReplicas
			}
			result = append(result, DeploymentDetail{
				Kind:              "StatefulSet",
				Name:              ss.Metadata.Name,
				Namespace:         ns,
				Replicas:          ss.Spec.Replicas,
				ReadyReplicas:     ss.Status.ReadyReplicas,
				AvailableReplicas: avail,
				Pods:              pods,
			})
		}
	}

	if cronJobs != nil {
		for _, cj := range cronJobs.Items {
			wk := workloadKey{"CronJob", cj.Metadata.Name}
			pods := buildPodDetails(podsByWorkload[wk], metricsMap, podStorageMap, pvcMap)
			active := int32(len(cj.Status.Active))
			result = append(result, DeploymentDetail{
				Kind:              "CronJob",
				Name:              cj.Metadata.Name,
				Namespace:         ns,
				Replicas:          active,
				ReadyReplicas:     active,
				AvailableReplicas: active,
				Pods:              pods,
			})
		}
	}

	if result == nil {
		result = []DeploymentDetail{}
	}
	jsonOK(w, WorkloadResponse{
		Workloads:           result,
		MetricsAvailable:    metricsAvailable,
		PrometheusAvailable: os.Getenv("PROMETHEUS_URL") != "",
	})
}

// buildPodDetails builds PodDetail list for a set of pods.
func buildPodDetails(
	pods []k8s.Pod,
	metricsMap map[string]map[string]k8s.ContainerUsage,
	podStorageMap map[string]podStorageStats,
	pvcMap map[string]k8s.PVC,
) []PodDetail {
	var result []PodDetail
	for _, pod := range pods {
		stoStats := podStorageMap[pod.Metadata.Name]
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
			if podMetrics, ok := metricsMap[pod.Metadata.Name]; ok {
				if cu, ok := podMetrics[c.Name]; ok {
					cr.Usage = &ResourcePair{
						CPU:    parseResource(cu.Usage["cpu"], true),
						Memory: parseResource(cu.Usage["memory"], false),
					}
				}
			}
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

		result = append(result, PodDetail{
			Name:       pod.Metadata.Name,
			Phase:      pod.Status.Phase,
			Containers: containers,
			Volumes:    volumes,
		})
	}
	return result
}

// --- Resource parsing ---

// parseResource converts a raw k8s resource string (e.g. "500m", "256Mi") into a typed ResourceValue.
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

// parseStorageBytes parses a storage quantity string into a ResourceValue with bytes populated.
func parseStorageBytes(raw string) ResourceValue {
	if raw == "" {
		return ResourceValue{}
	}
	b := parseMemoryBytes(raw)
	return ResourceValue{Raw: raw, Bytes: b}
}

// parseCPUMillicores converts a k8s CPU string to millicores.
// Handles nanocores ("18447n"), millicores ("500m"), and whole cores ("2").
func parseCPUMillicores(s string) int64 {
	if strings.HasSuffix(s, "n") {
		// nanocores (metrics-server returns e.g. "18447n") → millicores
		v, _ := strconv.ParseInt(strings.TrimSuffix(s, "n"), 10, 64)
		return v / 1_000_000
	}
	if strings.HasSuffix(s, "m") {
		v, _ := strconv.ParseInt(strings.TrimSuffix(s, "m"), 10, 64)
		return v
	}
	v, _ := strconv.ParseFloat(s, 64)
	return int64(v * 1000)
}

// parseMemoryBytes converts a k8s memory/storage quantity string to bytes.
// Supports binary (Ki/Mi/Gi/Ti) and decimal (K/M/G/T) suffixes.
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

// fmtBytes formats a byte count as a human-readable string (GiB/MiB/KiB/B).
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

// GetPodMetrics proxies raw pod metrics from metrics-server. Useful for debugging.
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
