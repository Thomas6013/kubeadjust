package main

import (
	"testing"
)

func TestParseClusters(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  map[string]string
	}{
		{
			"empty",
			"",
			map[string]string{},
		},
		{
			"single cluster",
			"prod=https://k8s.example.com",
			map[string]string{"prod": "https://k8s.example.com"},
		},
		{
			"multi cluster",
			"prod=https://k8s1.example.com,staging=https://k8s2.example.com",
			map[string]string{
				"prod":    "https://k8s1.example.com",
				"staging": "https://k8s2.example.com",
			},
		},
		{
			"whitespace trimmed",
			" prod = https://k8s.example.com , staging = https://k8s2.example.com ",
			map[string]string{
				"prod":    "https://k8s.example.com",
				"staging": "https://k8s2.example.com",
			},
		},
		{
			"skip malformed entries",
			"prod=https://k8s.example.com,badentry,=noname",
			map[string]string{"prod": "https://k8s.example.com"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseClusters(tt.input)
			if len(got) != len(tt.want) {
				t.Errorf("parseClusters(%q) = %v, want %v", tt.input, got, tt.want)
				return
			}
			for k, v := range tt.want {
				if got[k] != v {
					t.Errorf("parseClusters(%q)[%q] = %q, want %q", tt.input, k, got[k], v)
				}
			}
		})
	}
}

func TestParseSATokens(t *testing.T) {
	// Each sub-test uses t.Setenv which automatically restores the original value after.

	t.Run("SA_TOKEN sets default", func(t *testing.T) {
		t.Setenv("SA_TOKEN", "mytoken")
		t.Setenv("SA_TOKENS", "")
		tokens := parseSATokens()
		if tokens["default"] != "mytoken" {
			t.Errorf("tokens[default] = %q, want %q", tokens["default"], "mytoken")
		}
	})

	t.Run("SA_TOKENS multi-cluster", func(t *testing.T) {
		t.Setenv("SA_TOKEN", "")
		t.Setenv("SA_TOKENS", "prod=prodtoken,staging=stagingtoken")
		tokens := parseSATokens()
		if tokens["prod"] != "prodtoken" {
			t.Errorf("tokens[prod] = %q, want %q", tokens["prod"], "prodtoken")
		}
		if tokens["staging"] != "stagingtoken" {
			t.Errorf("tokens[staging] = %q, want %q", tokens["staging"], "stagingtoken")
		}
	})

	t.Run("SA_TOKEN_<CLUSTER> lowercases name", func(t *testing.T) {
		t.Setenv("SA_TOKEN", "")
		t.Setenv("SA_TOKENS", "")
		t.Setenv("SA_TOKEN_PROD", "prodtoken")
		tokens := parseSATokens()
		if tokens["prod"] != "prodtoken" {
			t.Errorf("tokens[prod] = %q, want %q", tokens["prod"], "prodtoken")
		}
		if tokens["PROD"] != "" {
			t.Error("uppercase key PROD should not be present")
		}
	})

	t.Run("SA_TOKEN_MY_CLUSTER uses hyphen separator", func(t *testing.T) {
		t.Setenv("SA_TOKEN", "")
		t.Setenv("SA_TOKENS", "")
		t.Setenv("SA_TOKEN_MY_CLUSTER", "myclustertoken")
		tokens := parseSATokens()
		if tokens["my-cluster"] != "myclustertoken" {
			t.Errorf("tokens[my-cluster] = %q, want %q", tokens["my-cluster"], "myclustertoken")
		}
	})

	t.Run("SA_TOKENS default overrides SA_TOKEN", func(t *testing.T) {
		t.Setenv("SA_TOKEN", "first")
		t.Setenv("SA_TOKENS", "default=second")
		tokens := parseSATokens()
		// SA_TOKENS is parsed after SA_TOKEN, so it overwrites
		if tokens["default"] != "second" {
			t.Errorf("tokens[default] = %q, want %q (SA_TOKENS should override SA_TOKEN)", tokens["default"], "second")
		}
	})

	t.Run("SA_TOKEN_* overrides SA_TOKENS", func(t *testing.T) {
		t.Setenv("SA_TOKEN", "")
		t.Setenv("SA_TOKENS", "prod=first")
		t.Setenv("SA_TOKEN_PROD", "second")
		tokens := parseSATokens()
		// SA_TOKEN_* is parsed last, so it overwrites SA_TOKENS
		if tokens["prod"] != "second" {
			t.Errorf("tokens[prod] = %q, want %q (SA_TOKEN_PROD should override SA_TOKENS)", tokens["prod"], "second")
		}
	})
}
