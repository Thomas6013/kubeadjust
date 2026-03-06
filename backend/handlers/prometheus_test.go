package handlers

import "testing"

func TestIsValidLabelValue(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"my-namespace", true},
		{"pod-abc-123", true},
		{"container", true},
		{"", false},
		{`inject"`, false},
		{`{bad}`, false},
		{`back\\slash`, false},
		{"normal-value", true},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := isValidLabelValue(tt.input)
			if got != tt.want {
				t.Errorf("isValidLabelValue(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}
