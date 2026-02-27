package prometheus

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"
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

// ContainerHistory is keyed by "pod/container".
type ContainerHistory struct {
	Pod       string      `json:"pod"`
	Container string      `json:"container"`
	CPU       []DataPoint `json:"cpu"`
	Memory    []DataPoint `json:"memory"`
}

// NamespaceHistoryResult holds history for all containers in a namespace.
type NamespaceHistoryResult struct {
	Containers []ContainerHistory `json:"containers"`
}

// TimeRange defines a query time range with appropriate step.
type TimeRange struct {
	Duration time.Duration
	Step     string // seconds
	RateWindow string // for rate() queries
}

// ParseTimeRange converts a range string (1h/6h/24h/7d) to a TimeRange.
func ParseTimeRange(r string) TimeRange {
	switch r {
	case "6h":
		return TimeRange{Duration: 6 * time.Hour, Step: "120", RateWindow: "5m"}
	case "24h":
		return TimeRange{Duration: 24 * time.Hour, Step: "300", RateWindow: "10m"}
	case "7d":
		return TimeRange{Duration: 7 * 24 * time.Hour, Step: "900", RateWindow: "15m"}
	default: // "1h"
		return TimeRange{Duration: 1 * time.Hour, Step: "60", RateWindow: "5m"}
	}
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
	// Ensure scheme is present (common misconfiguration)
	if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
		u = "http://" + u
	}
	u = strings.TrimRight(u, "/")
	return &Client{
		baseURL:    u,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// QueryRange fetches a PromQL range query with the given TimeRange.
func (c *Client) QueryRange(query string, tr TimeRange) ([]DataPoint, error) {
	now := time.Now()
	start := now.Add(-tr.Duration)

	params := url.Values{}
	params.Set("query", query)
	params.Set("start", strconv.FormatInt(start.Unix(), 10))
	params.Set("end", strconv.FormatInt(now.Unix(), 10))
	params.Set("step", tr.Step)

	resp, err := c.httpClient.Get(c.baseURL + "/api/v1/query_range?" + params.Encode())
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 10<<20)) // 10 MB cap
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("prometheus: %d %s", resp.StatusCode, string(body))
	}

	var result promRangeResponse
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

// QueryRangeMulti fetches a PromQL range query and returns results grouped by label values.
func (c *Client) QueryRangeMulti(query string, tr TimeRange) ([]promSeriesResult, error) {
	now := time.Now()
	start := now.Add(-tr.Duration)

	params := url.Values{}
	params.Set("query", query)
	params.Set("start", strconv.FormatInt(start.Unix(), 10))
	params.Set("end", strconv.FormatInt(now.Unix(), 10))
	params.Set("step", tr.Step)

	resp, err := c.httpClient.Get(c.baseURL + "/api/v1/query_range?" + params.Encode())
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("prometheus: %d %s", resp.StatusCode, string(body))
	}

	var result promRangeResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}
	if result.Status != "success" {
		return nil, nil
	}
	return result.Data.Result, nil
}

type promRangeResponse struct {
	Status string `json:"status"`
	Data   struct {
		Result []promSeriesResult `json:"result"`
	} `json:"data"`
}

type promSeriesResult struct {
	Metric map[string]string `json:"metric"`
	Values [][]interface{}   `json:"values"`
}

func parseValues(raw [][]interface{}) []DataPoint {
	points := make([]DataPoint, 0, len(raw))
	for _, pair := range raw {
		if len(pair) != 2 {
			continue
		}
		ts, ok := pair[0].(float64)
		if !ok {
			continue
		}
		vs, ok := pair[1].(string)
		if !ok {
			continue
		}
		v, err := strconv.ParseFloat(vs, 64)
		if err != nil {
			continue
		}
		points = append(points, DataPoint{T: int64(ts), V: v})
	}
	return points
}

// GetContainerHistory returns CPU (millicores) and memory (bytes) history for a container.
func (c *Client) GetContainerHistory(namespace, pod, container string, tr TimeRange) (*HistoryResult, error) {
	labels := fmt.Sprintf(`namespace="%s",pod="%s",container="%s"`, namespace, pod, container)

	cpuQuery := fmt.Sprintf(`rate(container_cpu_usage_seconds_total{%s}[%s]) * 1000`, labels, tr.RateWindow)
	memQuery := fmt.Sprintf(`container_memory_working_set_bytes{%s}`, labels)

	cpu, err := c.QueryRange(cpuQuery, tr)
	if err != nil {
		return nil, fmt.Errorf("cpu query: %w", err)
	}
	mem, err := c.QueryRange(memQuery, tr)
	if err != nil {
		return nil, fmt.Errorf("memory query: %w", err)
	}

	return &HistoryResult{CPU: cpu, Memory: mem}, nil
}

// GetNamespaceHistory returns CPU and memory history for all containers in a namespace.
func (c *Client) GetNamespaceHistory(namespace string, tr TimeRange) (*NamespaceHistoryResult, error) {
	nsLabel := fmt.Sprintf(`namespace="%s",container!=""`, namespace)
	cpuQuery := fmt.Sprintf(`rate(container_cpu_usage_seconds_total{%s}[%s]) * 1000`, nsLabel, tr.RateWindow)
	memQuery := fmt.Sprintf(`container_memory_working_set_bytes{%s}`, nsLabel)

	var cpuSeries, memSeries []promSeriesResult
	g := new(errgroup.Group)

	g.Go(func() error {
		var err error
		cpuSeries, err = c.QueryRangeMulti(cpuQuery, tr)
		return err
	})
	g.Go(func() error {
		var err error
		memSeries, err = c.QueryRangeMulti(memQuery, tr)
		return err
	})

	if err := g.Wait(); err != nil {
		return nil, err
	}

	// Index by pod/container
	type key struct{ pod, container string }
	idx := map[key]*ContainerHistory{}
	var mu sync.Mutex

	getOrCreate := func(k key) *ContainerHistory {
		mu.Lock()
		defer mu.Unlock()
		if ch, ok := idx[k]; ok {
			return ch
		}
		ch := &ContainerHistory{Pod: k.pod, Container: k.container}
		idx[k] = ch
		return ch
	}

	for _, s := range cpuSeries {
		k := key{pod: s.Metric["pod"], container: s.Metric["container"]}
		ch := getOrCreate(k)
		ch.CPU = parseValues(s.Values)
	}
	for _, s := range memSeries {
		k := key{pod: s.Metric["pod"], container: s.Metric["container"]}
		ch := getOrCreate(k)
		ch.Memory = parseValues(s.Values)
	}

	result := &NamespaceHistoryResult{Containers: make([]ContainerHistory, 0, len(idx))}
	for _, ch := range idx {
		result.Containers = append(result.Containers, *ch)
	}
	return result, nil
}
