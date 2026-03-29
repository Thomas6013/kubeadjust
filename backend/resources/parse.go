package resources

import (
	"log"
	"strconv"
	"strings"
)

// ParseCPUMillicores converts a k8s CPU string to millicores.
// Handles nanocores ("18447n"), millicores ("500m"), and whole cores ("2").
// Logs a warning and returns 0 for non-empty strings that cannot be parsed,
// so misconfigured resources are visible in server logs instead of silently zeroed.
func ParseCPUMillicores(s string) int64 {
	if s == "" {
		return 0
	}
	if body, ok := strings.CutSuffix(s, "n"); ok {
		v, err := strconv.ParseInt(body, 10, 64)
		if err != nil {
			log.Printf("ParseCPUMillicores: invalid nanocores value %q", s)
			return 0
		}
		return v / 1_000_000
	}
	if body, ok := strings.CutSuffix(s, "m"); ok {
		v, err := strconv.ParseInt(body, 10, 64)
		if err != nil {
			log.Printf("ParseCPUMillicores: invalid millicores value %q", s)
			return 0
		}
		return v
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		log.Printf("ParseCPUMillicores: invalid CPU value %q", s)
		return 0
	}
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
		if body, ok := strings.CutSuffix(s, sf.suffix); ok {
			v, _ := strconv.ParseInt(body, 10, 64)
			return v * sf.factor
		}
	}
	if body, ok := strings.CutSuffix(s, "n"); ok {
		v, _ := strconv.ParseInt(body, 10, 64)
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
