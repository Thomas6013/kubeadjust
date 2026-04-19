package k8s

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"time"
)

const defaultAPIServer = "https://kubernetes.default.svc"

// maxResponseBytes caps the size of K8s API responses.
const maxResponseBytes = 10 << 20 // 10 MB

// sharedTransport is created once at package init and reused across all requests.
// DialContext with KeepAlive mirrors http.DefaultTransport: the OS sends TCP keepalive
// probes every 30s so stale connections closed by the API server or a firewall are
// detected before the next request tries to reuse them.
var sharedTransport = &http.Transport{
	DialContext: (&net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
	}).DialContext,
	TLSClientConfig: &tls.Config{
		InsecureSkipVerify: envOr("KUBE_INSECURE_TLS", "false") == "true",
	},
	MaxIdleConns:        100,
	MaxIdleConnsPerHost: 20,
	IdleConnTimeout:     90 * time.Second,
}

type Client struct {
	apiServer  string
	token      string
	httpClient *http.Client
}

func New(token, apiServer string) *Client {
	if apiServer == "" {
		apiServer = envOr("KUBE_API_SERVER", defaultAPIServer)
	}
	return &Client{
		apiServer: apiServer,
		token:     token,
		httpClient: &http.Client{
			Timeout:   15 * time.Second,
			Transport: sharedTransport,
		},
	}
}

const maxRetries = 3

func (c *Client) get(ctx context.Context, path string, out interface{}) error {
	var lastErr error
	for attempt := range maxRetries {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if attempt > 0 {
			// Exponential backoff: 100ms, 400ms
			time.Sleep(time.Duration(100*(1<<(2*uint(attempt-1)))) * time.Millisecond)
		}
		lastErr = c.doGet(ctx, path, out)
		if lastErr == nil {
			return nil
		}
		// Only retry on 5xx or network errors, not 4xx (auth/not-found/bad-request)
		if isClientError(lastErr) {
			return lastErr
		}
	}
	return lastErr
}

func (c *Client) doGet(ctx context.Context, path string, out interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.apiServer+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return fmt.Errorf("reading response for %s: %w", path, err)
	}
	if int64(len(body)) == maxResponseBytes {
		return fmt.Errorf("kubernetes api %s: response exceeded %d MB limit", path, maxResponseBytes>>20)
	}
	if resp.StatusCode >= 400 {
		return &apiError{statusCode: resp.StatusCode, message: fmt.Sprintf("kubernetes api %s: %d %s", path, resp.StatusCode, string(body))}
	}
	return json.Unmarshal(body, out)
}

// apiError wraps HTTP error responses so retry logic can distinguish 4xx from 5xx.
type apiError struct {
	statusCode int
	message    string
}

func (e *apiError) Error() string { return e.message }

func isClientError(err error) bool {
	var ae *apiError
	if errors.As(err, &ae) {
		return ae.statusCode >= 400 && ae.statusCode < 500
	}
	return false
}

func (c *Client) VerifyToken(ctx context.Context) error {
	var out json.RawMessage
	return c.get(ctx, "/api", &out)
}

// --- API methods ---

// p escapes a path segment for safe interpolation into K8s API URLs.
func p(segment string) string { return url.PathEscape(segment) }

func (c *Client) ListNamespaces(ctx context.Context) (*NamespaceList, error) {
	var out NamespaceList
	return &out, c.get(ctx, "/api/v1/namespaces", &out)
}

func (c *Client) ListDeployments(ctx context.Context, namespace string) (*DeploymentList, error) {
	var out DeploymentList
	return &out, c.get(ctx, fmt.Sprintf("/apis/apps/v1/namespaces/%s/deployments", p(namespace)), &out)
}

func (c *Client) ListPods(ctx context.Context, namespace string) (*PodList, error) {
	var out PodList
	return &out, c.get(ctx, fmt.Sprintf("/api/v1/namespaces/%s/pods", p(namespace)), &out)
}

// ListPodsLimit lists up to `limit` pods in a namespace (useful for existence checks).
func (c *Client) ListPodsLimit(ctx context.Context, namespace string, limit int) (*PodList, error) {
	var out PodList
	return &out, c.get(ctx, fmt.Sprintf("/api/v1/namespaces/%s/pods?limit=%d", p(namespace), limit), &out)
}

func (c *Client) ListPodMetrics(ctx context.Context, namespace string) (*PodMetricsList, error) {
	var out PodMetricsList
	return &out, c.get(ctx, fmt.Sprintf("/apis/metrics.k8s.io/v1beta1/namespaces/%s/pods", p(namespace)), &out)
}

// ListAllPodMetrics returns pod metrics for all pods across all namespaces.
func (c *Client) ListAllPodMetrics(ctx context.Context) (*PodMetricsList, error) {
	if v, ok := allPodMetricsCache.get(c.apiServer); ok {
		return v, nil
	}
	var out PodMetricsList
	if err := c.get(ctx, "/apis/metrics.k8s.io/v1beta1/pods", &out); err != nil {
		return nil, err
	}
	allPodMetricsCache.set(c.apiServer, &out, ttlShort)
	return &out, nil
}

func (c *Client) ListNodes(ctx context.Context) (*NodeList, error) {
	if v, ok := nodesCache.get(c.apiServer); ok {
		return v, nil
	}
	var out NodeList
	if err := c.get(ctx, "/api/v1/nodes", &out); err != nil {
		return nil, err
	}
	nodesCache.set(c.apiServer, &out, ttlShort)
	return &out, nil
}

func (c *Client) ListNodeMetrics(ctx context.Context) (*NodeMetricsList, error) {
	if v, ok := nodeMetricsCache.get(c.apiServer); ok {
		return v, nil
	}
	var out NodeMetricsList
	if err := c.get(ctx, "/apis/metrics.k8s.io/v1beta1/nodes", &out); err != nil {
		return nil, err
	}
	nodeMetricsCache.set(c.apiServer, &out, ttlShort)
	return &out, nil
}

// ListAllPods lists pods across all namespaces (needed for node aggregation).
// Excludes Succeeded and Failed pods at the API level to reduce response size.
// Results are cached per cluster URL for ttlShort to avoid redundant cluster-wide fetches.
func (c *Client) ListAllPods(ctx context.Context) (*PodList, error) {
	if v, ok := allPodsCache.get(c.apiServer); ok {
		return v, nil
	}
	var out PodList
	if err := c.get(ctx, "/api/v1/pods?fieldSelector=status.phase!=Succeeded,status.phase!=Failed", &out); err != nil {
		return nil, err
	}
	allPodsCache.set(c.apiServer, &out, ttlShort)
	return &out, nil
}

func (c *Client) ListPVCs(ctx context.Context, namespace string) (*PVCList, error) {
	var out PVCList
	return &out, c.get(ctx, fmt.Sprintf("/api/v1/namespaces/%s/persistentvolumeclaims", p(namespace)), &out)
}

func (c *Client) ListReplicaSets(ctx context.Context, namespace string) (*ReplicaSetList, error) {
	var out ReplicaSetList
	return &out, c.get(ctx, fmt.Sprintf("/apis/apps/v1/namespaces/%s/replicasets", p(namespace)), &out)
}

func (c *Client) ListStatefulSets(ctx context.Context, namespace string) (*StatefulSetList, error) {
	var out StatefulSetList
	return &out, c.get(ctx, fmt.Sprintf("/apis/apps/v1/namespaces/%s/statefulsets", p(namespace)), &out)
}

func (c *Client) ListJobs(ctx context.Context, namespace string) (*JobList, error) {
	var out JobList
	return &out, c.get(ctx, fmt.Sprintf("/apis/batch/v1/namespaces/%s/jobs", p(namespace)), &out)
}

func (c *Client) ListCronJobs(ctx context.Context, namespace string) (*CronJobList, error) {
	var out CronJobList
	return &out, c.get(ctx, fmt.Sprintf("/apis/batch/v1/namespaces/%s/cronjobs", p(namespace)), &out)
}

// GetNodeSummary calls the kubelet stats/summary via the API server proxy.
// Requires nodes/proxy get permission. Best-effort: caller should handle errors.
// Results are cached per (cluster, node) for ttlLong to reduce kubelet proxy load.
func (c *Client) GetNodeSummary(ctx context.Context, nodeName string) (*NodeSummary, error) {
	key := c.apiServer + ":" + nodeName
	if v, ok := nodeSummaryCache.get(key); ok {
		return v, nil
	}
	var out NodeSummary
	if err := c.get(ctx, fmt.Sprintf("/api/v1/nodes/%s/proxy/stats/summary", p(nodeName)), &out); err != nil {
		return nil, err
	}
	nodeSummaryCache.set(key, &out, ttlLong)
	return &out, nil
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
