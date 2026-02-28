package resources

import (
	"strconv"
	"strings"
)

// ParseCPUMillicores converts a k8s CPU string to millicores.
// Handles nanocores ("18447n"), millicores ("500m"), and whole cores ("2").
func ParseCPUMillicores(s string) int64 {
	if strings.HasSuffix(s, "n") {
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

// ParseMemoryBytes converts a k8s memory/storage quantity string to bytes.
// Supports binary (Ki/Mi/Gi/Ti) and decimal (K/M/G/T) suffixes.
func ParseMemoryBytes(s string) int64 {
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

// ParseResource converts a raw k8s resource string into a typed ResourceValue.
func ParseResource(raw string, isCPU bool) ResourceValue {
	if raw == "" {
		return ResourceValue{Raw: ""}
	}
	rv := ResourceValue{Raw: raw}
	if isCPU {
		rv.Millicores = ParseCPUMillicores(raw)
	} else {
		rv.Bytes = ParseMemoryBytes(raw)
	}
	return rv
}

// ParseStorageBytes parses a storage quantity string into a ResourceValue with bytes populated.
func ParseStorageBytes(raw string) ResourceValue {
	if raw == "" {
		return ResourceValue{}
	}
	b := ParseMemoryBytes(raw)
	return ResourceValue{Raw: raw, Bytes: b}
}
