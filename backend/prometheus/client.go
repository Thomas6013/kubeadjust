package prometheus

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"
)

// DataPoint is a single (timestamp, value) sample.
type DataPoint struct {
	T int64   `json:"t"` // unix seconds
	V float64 `json:"v"` // millicores for CPU, bytes for memory
}

// HistoryResult holds CPU and memory time series for one container.
type HistoryResult struct {
	CPU    []DataPoint `json:"cpu"`
	Memory []DataPoint `json:"memory"`
}

// Client is a minimal Prometheus HTTP client.
type Client struct {
	baseURL    string
	httpClient *http.Client
}

// New returns a Client using PROMETHEUS_URL env var.
// Returns nil if the env var is not set.
func New() *Client {
	u := os.Getenv("PROMETHEUS_URL")
	if u == "" {
		return nil
	}
	return &Client{
		baseURL: u,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

// QueryRange fetches last `hours` hours of data with 2-minute step.
// query is a raw PromQL expression.
func (c *Client) QueryRange(query string) ([]DataPoint, error) {
	now := time.Now()
	start := now.Add(-1 * time.Hour)

	params := url.Values{}
	params.Set("query", query)
	params.Set("start", strconv.FormatInt(start.Unix(), 10))
	params.Set("end", strconv.FormatInt(now.Unix(), 10))
	params.Set("step", "120") // 2 minutes

	resp, err := c.httpClient.Get(c.baseURL + "/api/v1/query_range?" + params.Encode())
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("prometheus: %d %s", resp.StatusCode, string(body))
	}

	var result struct {
		Status string `json:"status"`
		Data   struct {
			Result []struct {
				Values [][]interface{} `json:"values"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}
	if result.Status != "success" || len(result.Data.Result) == 0 {
		return []DataPoint{}, nil
	}

	var points []DataPoint
	for _, raw := range result.Data.Result[0].Values {
		if len(raw) != 2 {
			continue
		}
		tsFloat, ok := raw[0].(float64)
		if !ok {
			continue
		}
		valStr, ok := raw[1].(string)
		if !ok {
			continue
		}
		v, err := strconv.ParseFloat(valStr, 64)
		if err != nil {
			continue
		}
		points = append(points, DataPoint{T: int64(tsFloat), V: v})
	}
	return points, nil
}

// GetContainerHistory returns CPU (millicores) and memory (bytes) history
// for the last hour for a given namespace/pod/container.
func (c *Client) GetContainerHistory(namespace, pod, container string) (*HistoryResult, error) {
	labels := fmt.Sprintf(`namespace="%s",pod="%s",container="%s"`, namespace, pod, container)

	cpuQuery := fmt.Sprintf(`rate(container_cpu_usage_seconds_total{%s}[5m]) * 1000`, labels)
	memQuery := fmt.Sprintf(`container_memory_working_set_bytes{%s}`, labels)

	cpu, err := c.QueryRange(cpuQuery)
	if err != nil {
		return nil, fmt.Errorf("cpu query: %w", err)
	}
	mem, err := c.QueryRange(memQuery)
	if err != nil {
		return nil, fmt.Errorf("memory query: %w", err)
	}

	return &HistoryResult{CPU: cpu, Memory: mem}, nil
}
