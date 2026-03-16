"use client";

import type { ClusterItem, TimeRange } from "@/lib/api";
import { APP_VERSION } from "@/lib/version";
import { buildClusterColors, clusterColor } from "@/lib/clusterColor";
import { KubeLogo } from "@/components/KubeLogo";
import type { AutoRefresh } from "@/hooks/useSessionState";
import styles from "@/app/dashboard/dashboard.module.css";

interface TopbarProps {
  cluster: string;
  clusters: ClusterItem[];
  showClusterMenu: boolean;
  setShowClusterMenu: (v: boolean | ((prev: boolean) => boolean)) => void;
  onClusterSwitch: (name: string) => void;
  lastRefresh: Date | null;
  prometheusAvailable: boolean;
  timeRange: TimeRange;
  setTimeRange: (r: TimeRange) => void;
  autoRefresh: AutoRefresh;
  setAutoRefresh: (v: AutoRefresh) => void;
  loading: boolean;
  onRefresh: () => void;
  onLogout: () => void;
}

export default function Topbar({
  cluster, clusters, showClusterMenu, setShowClusterMenu, onClusterSwitch,
  lastRefresh, prometheusAvailable, timeRange, setTimeRange,
  autoRefresh, setAutoRefresh, loading, onRefresh, onLogout,
}: TopbarProps) {
  const clusterColorMap = buildClusterColors(clusters.map((c) => c.name));
  const getMenuColor = (name: string) => clusterColorMap.get(name) ?? clusterColor(name);

  return (
    <header className={styles.topbar}>
      <div className={styles.brand}>
        <KubeLogo size={22} />
        KubeAdjust
        <span className={styles.version}>v{APP_VERSION}</span>
        {cluster && (
          clusters.length > 1 ? (
            <div className={styles.clusterSwitcher}>
              <button
                className={styles.clusterSwitchBtn}
                onClick={() => setShowClusterMenu((o) => !o)}
                title="Switch cluster"
              >
                <span
                  className={styles.clusterBadge}
                  style={{
                    borderColor: getMenuColor(cluster).border,
                    color: getMenuColor(cluster).accent,
                    background: getMenuColor(cluster).bg,
                  }}
                >
                  <span className={styles.clusterDot} style={{ background: getMenuColor(cluster).accent }} />
                  {cluster}
                </span>
                <span className={styles.clusterChevron}>{showClusterMenu ? "▴" : "▾"}</span>
              </button>
              {showClusterMenu && (
                <div className={styles.clusterMenu}>
                  {clusters.map((c) => {
                    const color = getMenuColor(c.name);
                    const isActive = c.name === cluster;
                    return (
                      <button
                        key={c.name}
                        className={`${styles.clusterMenuItem} ${isActive ? styles.clusterMenuItemActive : ""}`}
                        onClick={() => onClusterSwitch(c.name)}
                        style={isActive ? { color: color.accent, background: color.bg } : undefined}
                      >
                        <span className={styles.clusterDot} style={{ background: color.accent }} />
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <span
              className={styles.clusterBadge}
              style={{
                borderColor: clusterColor(cluster).border,
                color: clusterColor(cluster).accent,
                background: clusterColor(cluster).bg,
              }}
            >
              <span className={styles.clusterDot} style={{ background: clusterColor(cluster).accent }} />
              {cluster}
            </span>
          )
        )}
      </div>
      <div className={styles.actions}>
        {lastRefresh && <span className={styles.refreshed}>Refreshed {lastRefresh.toLocaleTimeString()}</span>}
        {prometheusAvailable && (
          <div className={styles.rangeSelector}>
            {(["1h", "6h", "24h", "7d"] as TimeRange[]).map((r) => (
              <button
                key={r}
                className={`${styles.rangeBtn} ${timeRange === r ? styles.rangeBtnActive : ""}`}
                onClick={() => setTimeRange(r)}
              >
                {r}
              </button>
            ))}
          </div>
        )}
        <div className={styles.autoRefresh}>
          {autoRefresh !== "off" && <span className={styles.liveDot} title="Auto-refresh active" />}
          <select
            className={styles.autoRefreshSelect}
            value={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.value as AutoRefresh)}
            aria-label="Auto-refresh interval"
          >
            <option value="off">Auto</option>
            <option value="30s">30s</option>
            <option value="60s">60s</option>
            <option value="5m">5min</option>
          </select>
        </div>
        <button className="ghost" onClick={onRefresh} disabled={loading}>
          {loading ? "Loading…" : "↺ Refresh"}
        </button>
        <button className="ghost" onClick={onLogout}>Sign out</button>
      </div>
    </header>
  );
}
