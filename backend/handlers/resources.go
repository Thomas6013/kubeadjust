package handlers

import (
	"log"
	"net/http"
	"os"
	"sync"

	"github.com/go-chi/chi/v5"
	"golang.org/x/sync/errgroup"

	"github.com/devops-kubeadjust/backend/k8s"
	"github.com/devops-kubeadjust/backend/middleware"
	"github.com/devops-kubeadjust/backend/resources"
)

// ListDeployments fetches all workloads (Deployments, StatefulSets, CronJobs) in a namespace
// along with per-container CPU/memory metrics, ephemeral storage, and PVC details.
func ListDeployments(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	token := middleware.TokenFromContext(r.Context())
	client := k8s.New(token, "")

	// 1. Fetch pods once
	podList, err := client.ListPods(ns)
	if err != nil {
		log.Printf("failed to list pods in %s: %v", ns, err)
		jsonError(w, "internal server error", http.StatusInternalServerError)
		return
	}

	// 2. Fetch workload types + auxiliary data in parallel
	var (
		deployments  *k8s.DeploymentList
		statefulSets *k8s.StatefulSetList
		cronJobs     *k8s.CronJobList
		rsList       *k8s.ReplicaSetList
		jobs         *k8s.JobList
		podMetrics   *k8s.PodMetricsList
		pvcList      *k8s.PVCList
	)

	g, _ := errgroup.WithContext(r.Context())

	g.Go(func() error {
		var err error
		deployments, err = client.ListDeployments(ns)
		return err // required — fail if deployments can't load
	})
	g.Go(func() error {
		ss, err := client.ListStatefulSets(ns)
		if err == nil {
			statefulSets = ss
		}
		return nil // best-effort
	})
	g.Go(func() error {
		cj, err := client.ListCronJobs(ns)
		if err == nil {
			cronJobs = cj
		}
		return nil
	})
	g.Go(func() error {
		rs, err := client.ListReplicaSets(ns)
		if err == nil {
			rsList = rs
		}
		return nil
	})
	g.Go(func() error {
		jl, err := client.ListJobs(ns)
		if err == nil {
			jobs = jl
		}
		return nil
	})
	g.Go(func() error {
		pm, err := client.ListPodMetrics(ns)
		if err == nil {
			podMetrics = pm
		}
		return nil // best-effort
	})
	g.Go(func() error {
		pvcs, err := client.ListPVCs(ns)
		if err == nil {
			pvcList = pvcs
		}
		return nil
	})

	if err := g.Wait(); err != nil {
		log.Printf("failed to fetch workloads in %s: %v", ns, err)
		jsonError(w, "internal server error", http.StatusInternalServerError)
		return
	}

	// 3. Build pod → workload ownership map
	podToWorkload := resources.BuildOwnerMaps(podList.Items, rsList, jobs)

	// 4. Build metrics lookup
	metricsMap := map[string]map[string]k8s.ContainerUsage{}
	metricsAvailable := podMetrics != nil
	if podMetrics != nil {
		for _, pm := range podMetrics.Items {
			m := map[string]k8s.ContainerUsage{}
			for _, cu := range pm.Containers {
				m[cu.Name] = cu
			}
			metricsMap[pm.Metadata.Name] = m
		}
	}

	// 5. Fetch node summaries in parallel for storage stats (best-effort)
	nodeNames := map[string]struct{}{}
	for _, pod := range podList.Items {
		if pod.Spec.NodeName != "" {
			nodeNames[pod.Spec.NodeName] = struct{}{}
		}
	}
	podStorageMap := map[string]resources.PodStorageStats{}
	var storageMu sync.Mutex
	var storageG errgroup.Group
	storageG.SetLimit(5) // bound concurrent kubelet calls
	for node := range nodeNames {
		node := node
		storageG.Go(func() error {
			summary, err := client.GetNodeSummary(node)
			if err != nil {
				return nil // best-effort
			}
			storageMu.Lock()
			defer storageMu.Unlock()
			for _, ps := range summary.Pods {
				if ps.PodRef.Namespace != ns {
					continue
				}
				stats := resources.PodStorageStats{
					ContainerEphemeral: map[string]int64{},
					Volumes:            map[string]k8s.VolumeStatsSummary{},
				}
				for _, cs := range ps.Containers {
					var used int64
					if cs.Rootfs != nil {
						used += cs.Rootfs.UsedBytes
					}
					if cs.Logs != nil {
						used += cs.Logs.UsedBytes
					}
					stats.ContainerEphemeral[cs.Name] = used
				}
				for _, vs := range ps.Volumes {
					stats.Volumes[vs.Name] = vs
				}
				podStorageMap[ps.PodRef.Name] = stats
			}
			return nil
		})
	}
	_ = storageG.Wait()

	// 6. Build PVC lookup
	pvcMap := map[string]k8s.PVC{}
	if pvcList != nil {
		for _, pvc := range pvcList.Items {
			pvcMap[pvc.Metadata.Name] = pvc
		}
	}

	// 7. Group pods by workload
	podsByWorkload := map[resources.WorkloadKey][]k8s.Pod{}
	for _, pod := range podList.Items {
		if wk, ok := podToWorkload[pod.Metadata.Name]; ok {
			podsByWorkload[wk] = append(podsByWorkload[wk], pod)
		}
	}

	// 8. Build response — Deployments, StatefulSets, CronJobs
	var result []resources.DeploymentDetail

	for _, dep := range deployments.Items {
		wk := resources.WorkloadKey{Kind: "Deployment", Name: dep.Metadata.Name}
		pods := resources.BuildPodDetails(podsByWorkload[wk], metricsMap, podStorageMap, pvcMap)
		result = append(result, resources.DeploymentDetail{
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
			wk := resources.WorkloadKey{Kind: "StatefulSet", Name: ss.Metadata.Name}
			pods := resources.BuildPodDetails(podsByWorkload[wk], metricsMap, podStorageMap, pvcMap)
			avail := ss.Status.AvailableReplicas
			if avail == 0 {
				avail = ss.Status.CurrentReplicas
			}
			result = append(result, resources.DeploymentDetail{
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
			wk := resources.WorkloadKey{Kind: "CronJob", Name: cj.Metadata.Name}
			pods := resources.BuildPodDetails(podsByWorkload[wk], metricsMap, podStorageMap, pvcMap)
			active := int32(len(cj.Status.Active))
			result = append(result, resources.DeploymentDetail{
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
		result = []resources.DeploymentDetail{}
	}
	jsonOK(w, resources.WorkloadResponse{
		Workloads:           result,
		MetricsAvailable:    metricsAvailable,
		PrometheusAvailable: os.Getenv("PROMETHEUS_URL") != "",
	})
}

// GetPodMetrics proxies raw pod metrics from metrics-server. Useful for debugging.
func GetPodMetrics(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	client := k8s.New(middleware.TokenFromContext(r.Context()), "")
	metrics, err := client.ListPodMetrics(ns)
	if err != nil {
		log.Printf("metrics-server error for %s: %v", ns, err)
		jsonError(w, "metrics-server unavailable", http.StatusServiceUnavailable)
		return
	}
	jsonOK(w, metrics)
}
