package handlers

import "testing"

func TestParseCPUMillicores(t *testing.T) {
	tests := []struct {
		input string
		want  int64
	}{
		{"500m", 500},
		{"100m", 100},
		{"2", 2000},
		{"0.5", 500},
		{"18447n", 0},          // 18447 / 1_000_000 = 0 (truncated)
		{"1000000n", 1},        // 1_000_000 / 1_000_000 = 1
		{"1500000000n", 1500},  // 1.5 cores
		{"", 0},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := parseCPUMillicores(tt.input)
			if got != tt.want {
				t.Errorf("parseCPUMillicores(%q) = %d, want %d", tt.input, got, tt.want)
			}
		})
	}
}

func TestParseMemoryBytes(t *testing.T) {
	tests := []struct {
		input string
		want  int64
	}{
		{"128Mi", 128 * 1024 * 1024},
		{"1Gi", 1024 * 1024 * 1024},
		{"500Ki", 500 * 1024},
		{"1000M", 1000 * 1000 * 1000},
		{"2G", 2 * 1000 * 1000 * 1000},
		{"1Ti", 1024 * 1024 * 1024 * 1024},
		{"1048576", 1048576},
		{"", 0},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := parseMemoryBytes(tt.input)
			if got != tt.want {
				t.Errorf("parseMemoryBytes(%q) = %d, want %d", tt.input, got, tt.want)
			}
		})
	}
}
