package resources

import "github.com/devops-kubeadjust/backend/k8s"

// BuildOwnerMaps resolves pod → workload ownership using OwnerReferences.
// Returns a map of podName → WorkloadKey.
func BuildOwnerMaps(pods []k8s.Pod, rsList *k8s.ReplicaSetList, jobs *k8s.JobList) map[string]WorkloadKey {
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
	podToWorkload := map[string]WorkloadKey{}
	for _, pod := range pods {
		for _, ref := range pod.Metadata.OwnerReferences {
			switch ref.Kind {
			case "ReplicaSet":
				if depName, ok := rsToDeployment[ref.Name]; ok {
					podToWorkload[pod.Metadata.Name] = WorkloadKey{Kind: "Deployment", Name: depName}
				}
			case "StatefulSet":
				podToWorkload[pod.Metadata.Name] = WorkloadKey{Kind: "StatefulSet", Name: ref.Name}
			case "Job":
				if cronName, ok := jobToCronJob[ref.Name]; ok {
					podToWorkload[pod.Metadata.Name] = WorkloadKey{Kind: "CronJob", Name: cronName}
				}
			}
		}
	}
	return podToWorkload
}

// BuildPodDetails builds PodDetail list for a set of pods.
func BuildPodDetails(
	pods []k8s.Pod,
	metricsMap map[string]map[string]k8s.ContainerUsage,
	podStorageMap map[string]PodStorageStats,
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
					CPU:    ParseResource(c.Resources.Requests["cpu"], true),
					Memory: ParseResource(c.Resources.Requests["memory"], false),
				},
				Limits: ResourcePair{
					CPU:    ParseResource(c.Resources.Limits["cpu"], true),
					Memory: ParseResource(c.Resources.Limits["memory"], false),
				},
			}
			if podMetrics, ok := metricsMap[pod.Metadata.Name]; ok {
				if cu, ok := podMetrics[c.Name]; ok {
					cr.Usage = &ResourcePair{
						CPU:    ParseResource(cu.Usage["cpu"], true),
						Memory: ParseResource(cu.Usage["memory"], false),
					}
				}
			}
			ephInfo := &EphemeralStorageInfo{}
			if reqRaw := c.Resources.Requests["ephemeral-storage"]; reqRaw != "" {
				v := ParseStorageBytes(reqRaw)
				ephInfo.Request = &v
			}
			if limRaw := c.Resources.Limits["ephemeral-storage"]; limRaw != "" {
				v := ParseStorageBytes(limRaw)
				ephInfo.Limit = &v
			}
			if stoStats.ContainerEphemeral != nil {
				if used, ok := stoStats.ContainerEphemeral[c.Name]; ok {
					v := ResourceValue{Bytes: used, Raw: FmtBytes(used)}
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
						v := ParseStorageBytes(cap)
						vd.Capacity = &v
					}
				}
				if stoStats.Volumes != nil {
					if vs, ok := stoStats.Volumes[vol.Name]; ok {
						u := ResourceValue{Bytes: vs.UsedBytes, Raw: FmtBytes(vs.UsedBytes)}
						a := ResourceValue{Bytes: vs.AvailableBytes, Raw: FmtBytes(vs.AvailableBytes)}
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
					v := ParseStorageBytes(vol.EmptyDir.SizeLimit)
					vd.SizeLimit = &v
				}
				if stoStats.Volumes != nil {
					if vs, ok := stoStats.Volumes[vol.Name]; ok {
						u := ResourceValue{Bytes: vs.UsedBytes, Raw: FmtBytes(vs.UsedBytes)}
						vd.Usage = &u
						if vs.CapacityBytes > 0 {
							c := ResourceValue{Bytes: vs.CapacityBytes, Raw: FmtBytes(vs.CapacityBytes)}
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
