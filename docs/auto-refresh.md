# Auto-refresh

The dashboard supports automatic background refresh with a configurable interval.

## Usage

In the topbar, next to the manual refresh button, a dropdown lets you choose:

| Option | Interval |
|---|---|
| Auto (default) | Off |
| 30s | 30 seconds |
| 60s | 60 seconds |
| 5min | 5 minutes |

When active, a small green pulsing dot appears next to the selector.

The selected interval is persisted in `sessionStorage` and restored on the next visit.

## Behaviour

- **Silent update** — existing data stays visible while the refresh runs in the background. The view does not flash to a loading state.
- **Tab visibility** — auto-refresh pauses automatically when the browser tab is hidden (Page Visibility API) and resumes when the tab becomes visible again.
- **Skip if loading** — if a manual refresh or initial load is already in progress, the scheduled tick is skipped to avoid concurrent requests.
- **Prometheus history** — the namespace-wide history is *not* re-fetched on every auto-refresh tick. It is only updated when the time range selector changes, which keeps Prometheus load low.

## Performance considerations

- At 30 s on a large cluster, the `/api/nodes` endpoint fetches all pods cluster-wide on every tick. If this causes noticeable load, use 60 s or 5 min instead.
- The interval only triggers the currently visible view (nodes or namespace deployments), not both.
