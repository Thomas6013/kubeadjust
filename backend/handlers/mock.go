package handlers

const MockToken = "mock-dev-token"

func isMock(token string) bool {
	return token == MockToken
}

func mockNamespaces() []NamespaceItem {
	return []NamespaceItem{
		{Name: "default"},
		{Name: "kube-system"},
		{Name: "monitoring"},
		{Name: "production"},
	}
}

func mockDeployments(namespace string) []DeploymentDetail {
	switch namespace {
	case "production":
		return []DeploymentDetail{
			{
				Name: "api-gateway", Namespace: namespace,
				Replicas: 3, ReadyReplicas: 3, AvailableReplicas: 3,
				Pods: []PodDetail{
					mockPodFull("api-gateway-7d9f8b-xk2p1", "Running",
						[]mockContainer{
							{name: "api-gateway", cpuReq: "250m", cpuLim: "500m", cpuUse: "180m", memReq: "256Mi", memLim: "512Mi", memUse: "310Mi",
								ephReq: "100Mi", ephLim: "500Mi", ephUse: 82 * 1024 * 1024},
						},
						[]VolumeDetail{
							mockEmptyDir("tmp", "", nil, int64Ptr(95*1024*1024)),
						}),
					mockPodFull("api-gateway-7d9f8b-mn3q7", "Running",
						[]mockContainer{
							{name: "api-gateway", cpuReq: "250m", cpuLim: "500m", cpuUse: "220m", memReq: "256Mi", memLim: "512Mi", memUse: "280Mi",
								ephReq: "100Mi", ephLim: "500Mi", ephUse: 65 * 1024 * 1024},
						},
						[]VolumeDetail{
							mockEmptyDir("tmp", "", nil, int64Ptr(60*1024*1024)),
						}),
					mockPodFull("api-gateway-7d9f8b-zr4w9", "Running",
						[]mockContainer{
							{name: "api-gateway", cpuReq: "250m", cpuLim: "500m", cpuUse: "90m", memReq: "256Mi", memLim: "512Mi", memUse: "198Mi",
								ephReq: "100Mi", ephLim: "500Mi", ephUse: 30 * 1024 * 1024},
						},
						[]VolumeDetail{
							mockEmptyDir("tmp", "", nil, int64Ptr(28*1024*1024)),
						}),
				},
			},
			{
				Name: "user-service", Namespace: namespace,
				Replicas: 2, ReadyReplicas: 2, AvailableReplicas: 2,
				Pods: []PodDetail{
					mockPodFull("user-service-5c6d7e-ab1c2", "Running",
						[]mockContainer{
							// no ephemeral-storage limit set — suggestion should appear
							{name: "user-service", cpuReq: "100m", cpuLim: "200m", cpuUse: "155m", memReq: "128Mi", memLim: "256Mi", memUse: "240Mi",
								ephReq: "", ephLim: "", ephUse: 312 * 1024 * 1024},
						},
						[]VolumeDetail{
							mockPVC("user-data", "user-data-pvc", "standard", []string{"ReadWriteOnce"},
								int64Ptr(10*1024*1024*1024), int64Ptr(8_650*1024*1024), int64Ptr(1_350*1024*1024)),
						}),
					mockPodFull("user-service-5c6d7e-de3f4", "Running",
						[]mockContainer{
							{name: "user-service", cpuReq: "100m", cpuLim: "200m", cpuUse: "98m", memReq: "128Mi", memLim: "256Mi", memUse: "112Mi",
								ephReq: "", ephLim: "", ephUse: 280 * 1024 * 1024},
						},
						[]VolumeDetail{
							mockPVC("user-data", "user-data-pvc", "standard", []string{"ReadWriteOnce"},
								int64Ptr(10*1024*1024*1024), int64Ptr(8_650*1024*1024), int64Ptr(1_350*1024*1024)),
						}),
				},
			},
			{
				Name: "payment-worker", Namespace: namespace,
				Replicas: 2, ReadyReplicas: 1, AvailableReplicas: 1,
				Pods: []PodDetail{
					mockPodFull("payment-worker-3a4b5c-gh5i6", "Running",
						[]mockContainer{
							{name: "payment-worker", cpuReq: "500m", cpuLim: "1000m", cpuUse: "820m", memReq: "512Mi", memLim: "1Gi", memUse: "980Mi",
								ephReq: "200Mi", ephLim: "1Gi", ephUse: 980 * 1024 * 1024}, // almost at ephemeral limit
						},
						[]VolumeDetail{
							// emptyDir with no sizeLimit
							mockEmptyDir("processing-tmp", "", nil, int64Ptr(2_300*1024*1024)),
						}),
					mockPodFull("payment-worker-3a4b5c-jk7l8", "Pending",
						[]mockContainer{
							{name: "payment-worker", cpuReq: "500m", cpuLim: "1000m", cpuUse: "", memReq: "512Mi", memLim: "1Gi", memUse: "",
								ephReq: "200Mi", ephLim: "1Gi", ephUse: 0},
						},
						nil),
				},
			},
			{
				Name: "cache-proxy", Namespace: namespace,
				Replicas: 1, ReadyReplicas: 1, AvailableReplicas: 1,
				Pods: []PodDetail{
					mockPodFull("cache-proxy-1f2e3d-mn9o0", "Running",
						[]mockContainer{
							{name: "redis", cpuReq: "50m", cpuLim: "100m", cpuUse: "12m", memReq: "64Mi", memLim: "128Mi", memUse: "45Mi",
								ephReq: "", ephLim: "", ephUse: 8 * 1024 * 1024},
							{name: "exporter", cpuReq: "10m", cpuLim: "50m", cpuUse: "3m", memReq: "16Mi", memLim: "32Mi", memUse: "18Mi",
								ephReq: "", ephLim: "", ephUse: 2 * 1024 * 1024},
						},
						[]VolumeDetail{
							mockEmptyDir("redis-data", "Memory", nil, int64Ptr(42*1024*1024)),
						}),
				},
			},
		}
	case "monitoring":
		return []DeploymentDetail{
			{
				Name: "prometheus", Namespace: namespace,
				Replicas: 1, ReadyReplicas: 1, AvailableReplicas: 1,
				Pods: []PodDetail{
					mockPodFull("prometheus-0", "Running",
						[]mockContainer{
							{name: "prometheus", cpuReq: "500m", cpuLim: "1", cpuUse: "340m", memReq: "1Gi", memLim: "2Gi", memUse: "1.4Gi",
								ephReq: "", ephLim: "", ephUse: 15 * 1024 * 1024},
						},
						[]VolumeDetail{
							mockPVC("prometheus-data", "prometheus-data-pvc", "ssd", []string{"ReadWriteOnce"},
								int64Ptr(50*1024*1024*1024), int64Ptr(32*1024*1024*1024), int64Ptr(18*1024*1024*1024)),
						}),
				},
			},
			{
				Name: "grafana", Namespace: namespace,
				Replicas: 1, ReadyReplicas: 1, AvailableReplicas: 1,
				Pods: []PodDetail{
					mockPodFull("grafana-6b7c8d-pq1r2", "Running",
						[]mockContainer{
							{name: "grafana", cpuReq: "100m", cpuLim: "200m", cpuUse: "55m", memReq: "128Mi", memLim: "256Mi", memUse: "88Mi",
								ephReq: "", ephLim: "", ephUse: 5 * 1024 * 1024},
						},
						[]VolumeDetail{
							mockPVC("grafana-storage", "grafana-pvc", "standard", []string{"ReadWriteOnce"},
								int64Ptr(5*1024*1024*1024), int64Ptr(1_200*1024*1024), int64Ptr(3_800*1024*1024)),
						}),
				},
			},
		}
	case "default":
		return []DeploymentDetail{
			{
				Name: "nginx-ingress", Namespace: namespace,
				Replicas: 2, ReadyReplicas: 2, AvailableReplicas: 2,
				Pods: []PodDetail{
					mockPodFull("nginx-ingress-9a8b7c-st3u4", "Running",
						[]mockContainer{
							{name: "controller", cpuReq: "100m", cpuLim: "500m", cpuUse: "75m", memReq: "90Mi", memLim: "256Mi", memUse: "102Mi",
								ephReq: "", ephLim: "", ephUse: 12 * 1024 * 1024},
						},
						nil),
					mockPodFull("nginx-ingress-9a8b7c-vw5x6", "Running",
						[]mockContainer{
							{name: "controller", cpuReq: "100m", cpuLim: "500m", cpuUse: "88m", memReq: "90Mi", memLim: "256Mi", memUse: "97Mi",
								ephReq: "", ephLim: "", ephUse: 14 * 1024 * 1024},
						},
						nil),
				},
			},
		}
	default:
		return []DeploymentDetail{}
	}
}

// --- mock helpers ---

type mockContainer struct {
	name, cpuReq, cpuLim, cpuUse string
	memReq, memLim, memUse        string
	ephReq, ephLim                string
	ephUse                        int64 // bytes, 0 = no data
}

func mockPodFull(name, phase string, containers []mockContainer, volumes []VolumeDetail) PodDetail {
	var cs []ContainerResources
	for _, c := range containers {
		cr := ContainerResources{
			Name: c.name,
			Requests: ResourcePair{
				CPU:    parseResource(c.cpuReq, true),
				Memory: parseResource(c.memReq, false),
			},
			Limits: ResourcePair{
				CPU:    parseResource(c.cpuLim, true),
				Memory: parseResource(c.memLim, false),
			},
		}
		if c.cpuUse != "" || c.memUse != "" {
			cr.Usage = &ResourcePair{
				CPU:    parseResource(c.cpuUse, true),
				Memory: parseResource(c.memUse, false),
			}
		}
		eph := &EphemeralStorageInfo{}
		if c.ephReq != "" {
			v := parseStorageBytes(c.ephReq)
			eph.Request = &v
		}
		if c.ephLim != "" {
			v := parseStorageBytes(c.ephLim)
			eph.Limit = &v
		}
		if c.ephUse > 0 {
			v := ResourceValue{Bytes: c.ephUse, Raw: fmtBytes(c.ephUse)}
			eph.Usage = &v
		}
		cr.EphemeralStorage = eph
		cs = append(cs, cr)
	}
	return PodDetail{Name: name, Phase: phase, Containers: cs, Volumes: volumes}
}

func mockPVC(volName, claimName, storageClass string, accessModes []string, capacity, used, available *int64) VolumeDetail {
	vd := VolumeDetail{
		Name:         volName,
		Type:         "pvc",
		PVCName:      claimName,
		StorageClass: storageClass,
		AccessModes:  accessModes,
	}
	if capacity != nil {
		v := ResourceValue{Bytes: *capacity, Raw: fmtBytes(*capacity)}
		vd.Capacity = &v
	}
	if used != nil {
		v := ResourceValue{Bytes: *used, Raw: fmtBytes(*used)}
		vd.Usage = &v
	}
	if available != nil {
		v := ResourceValue{Bytes: *available, Raw: fmtBytes(*available)}
		vd.Available = &v
	}
	return vd
}

func mockEmptyDir(name, medium string, sizeLimit *int64, used *int64) VolumeDetail {
	vd := VolumeDetail{Name: name, Type: "emptyDir", Medium: medium}
	if sizeLimit != nil {
		v := ResourceValue{Bytes: *sizeLimit, Raw: fmtBytes(*sizeLimit)}
		vd.SizeLimit = &v
	}
	if used != nil {
		v := ResourceValue{Bytes: *used, Raw: fmtBytes(*used)}
		vd.Usage = &v
	}
	return vd
}

func int64Ptr(v int64) *int64 { return &v }

func mockNodes() []NodeOverview {
	cpu := func(m int64) ResourceValue { return ResourceValue{Millicores: m, Raw: fmtBytes(m) + "m"} }
	mem := func(b int64) ResourceValue { return ResourceValue{Bytes: b, Raw: fmtBytes(b)} }
	var gib int64 = 1024 * 1024 * 1024

	usage := func(cpuM, memB int64) *NodeResources {
		return &NodeResources{CPU: cpu(cpuM), Memory: mem(memB)}
	}

	return []NodeOverview{
		{
			Name: "node-master-1", Status: "Ready", Roles: []string{"control-plane"},
			Capacity:    NodeResources{CPU: cpu(4000), Memory: mem(8 * gib)},
			Allocatable: NodeResources{CPU: cpu(3800), Memory: mem(7 * gib)},
			Requested:   NodeResources{CPU: cpu(1200), Memory: mem(3 * gib)},
			Limited:     NodeResources{CPU: cpu(3000), Memory: mem(6 * gib)},
			Usage:       usage(620, gib*18/10),
			PodCount: 12, MaxPods: 110,
		},
		{
			// Worker heavily over-provisioned on memory (allocated >> used)
			Name: "node-worker-1", Status: "Ready", Roles: []string{"worker"},
			Capacity:    NodeResources{CPU: cpu(8000), Memory: mem(32 * gib)},
			Allocatable: NodeResources{CPU: cpu(7800), Memory: mem(31 * gib)},
			Requested:   NodeResources{CPU: cpu(3200), Memory: mem(26 * gib)},
			Limited:     NodeResources{CPU: cpu(6000), Memory: mem(30 * gib)},
			Usage:       usage(1850, gib*84/10),
			PodCount: 28, MaxPods: 110,
		},
		{
			// Worker with CPU close to allocatable
			Name: "node-worker-2", Status: "Ready", Roles: []string{"worker"},
			Capacity:    NodeResources{CPU: cpu(8000), Memory: mem(32 * gib)},
			Allocatable: NodeResources{CPU: cpu(7800), Memory: mem(31 * gib)},
			Requested:   NodeResources{CPU: cpu(7100), Memory: mem(14 * gib)},
			Limited:     NodeResources{CPU: cpu(7600), Memory: mem(22 * gib)},
			Usage:       usage(6200, gib*112/10),
			PodCount: 41, MaxPods: 110,
		},
		{
			Name: "node-worker-3", Status: "NotReady", Roles: []string{"worker"},
			Capacity:    NodeResources{CPU: cpu(8000), Memory: mem(32 * gib)},
			Allocatable: NodeResources{CPU: cpu(7800), Memory: mem(31 * gib)},
			Requested:   NodeResources{CPU: cpu(0), Memory: mem(0)},
			Limited:     NodeResources{CPU: cpu(0), Memory: mem(0)},
			Usage:       nil,
			PodCount: 0, MaxPods: 110,
		},
	}
}
