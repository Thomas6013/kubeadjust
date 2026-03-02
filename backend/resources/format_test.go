package resources

import "testing"

func TestFmtBytes(t *testing.T) {
	tests := []struct {
		input int64
		want  string
	}{
		{0, "0 B"},
		{512, "512 B"},
		{1023, "1023 B"},
		{1024, "1 Ki"},
		{2048, "2 Ki"},
		{1024 * 1024, "1 Mi"},
		{512 * 1024 * 1024, "512 Mi"},
		{1024 * 1024 * 1024, "1.00 Gi"},
		{int64(1.5 * 1024 * 1024 * 1024), "1.50 Gi"},
	}
	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			got := FmtBytes(tt.input)
			if got != tt.want {
				t.Errorf("FmtBytes(%d) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestFmtMillicores(t *testing.T) {
	tests := []struct {
		input int64
		want  string
	}{
		{0, "0m"},
		{500, "500m"},
		{999, "999m"},
		{1000, "1.00"},
		{1500, "1.50"},
		{2000, "2.00"},
	}
	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			got := FmtMillicores(tt.input)
			if got != tt.want {
				t.Errorf("FmtMillicores(%d) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
