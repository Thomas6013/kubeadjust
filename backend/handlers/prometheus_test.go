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
		{"kube.system", true},
		{"my_pod", true},
		{"UPPER.case-Mix_123", true},
		{"", false},
		{`inject"`, false},
		{`{bad}`, false},
		{`back\\slash`, false},
		{`back\slash`, false},
		{"normal-value", true},
		{"has space", false},
		{"semi;colon", false},
		{"new\nline", false},
		{"tab\there", false},
		{"paren(s)", false},
		{"slash/path", false},
		{"colon:port", false},
		{"equals=val", false},
		{"amp&er", false},
		{"pipe|val", false},
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
