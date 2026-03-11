"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api, type ClusterItem } from "@/lib/api";
import { MANAGED_TOKEN, tokenKey } from "@/lib/storage";
import { clusterColor } from "@/lib/clusterColor";
import { KubeLogo } from "@/components/KubeLogo";
import styles from "./login.module.css";

export default function LoginPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [clusters, setClusters] = useState<ClusterItem[]>([]);
  const [selectedCluster, setSelectedCluster] = useState("");
  const [oidcEnabled, setOidcEnabled] = useState<boolean | null>(null);
  const [managedDefault, setManagedDefault] = useState(false);

  useEffect(() => {
    api.clusters().then((list) => {
      setClusters(list);
      if (list.length === 0) return;
      const saved = sessionStorage.getItem("kube-cluster");
      if (saved && list.some((c) => c.name === saved)) {
        setSelectedCluster(saved);
      } else {
        setSelectedCluster(list[0].name);
      }
    });
    api.authConfig().then((cfg) => {
      setOidcEnabled(cfg.oidcEnabled);
      setManagedDefault(cfg.managedDefault);
    });

    // Show error from OIDC redirect if present
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (err) {
      if (err === "access_denied") setError("Access denied. Your account is not authorised to use this dashboard.");
      else if (err === "auth_failed") setError("Authentication failed. Please try again.");
      else setError("OIDC provider unavailable.");
    }
  }, []);

  // Derived: is the currently selected cluster backend-managed?
  const selectedClusterManaged =
    managedDefault ||
    (clusters.length > 0 && clusters.find((c) => c.name === selectedCluster)?.managed === true);

  function handleManagedEnter() {
    try {
      if (selectedCluster) sessionStorage.setItem("kube-cluster", selectedCluster);
      sessionStorage.setItem(tokenKey(selectedCluster), MANAGED_TOKEN);
    } catch { /* ignore */ }
    router.push("/dashboard");
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (selectedCluster) sessionStorage.setItem("kube-cluster", selectedCluster);
      await api.verify(token.trim());
      sessionStorage.setItem(tokenKey(selectedCluster), token.trim());
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  function handleSSOLogin() {
    if (selectedCluster) {
      try { sessionStorage.setItem("kube-cluster", selectedCluster); } catch { /* ignore */ }
    }
    window.location.href = "/auth/login";
  }

  return (
    <main className={styles.container}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <KubeLogo size={36} />
          <h1>KubeAdjust</h1>
        </div>
        <p className={styles.subtitle}>Resource limits &amp; requests dashboard</p>

        {clusters.length > 0 && (
          <>
            <label>Cluster</label>
            <div className={styles.clusterGrid}>
              {clusters.map((c) => {
                const color = clusterColor(c.name);
                const isActive = selectedCluster === c.name;
                return (
                  <button
                    key={c.name}
                    type="button"
                    className={`${styles.clusterCard} ${isActive ? styles.clusterCardActive : ""}`}
                    onClick={() => setSelectedCluster(c.name)}
                    style={{
                      "--cluster-accent": color.accent,
                      "--cluster-bg": color.bg,
                      "--cluster-border": color.border,
                    } as React.CSSProperties}
                  >
                    <span
                      className={styles.clusterAvatar}
                      style={{ background: color.bg, borderColor: color.border, color: color.accent }}
                    >
                      {c.name.charAt(0).toUpperCase()}
                    </span>
                    <span className={styles.clusterName}>{c.name}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {oidcEnabled === null ? null : selectedClusterManaged ? (
          <>
            {error && <p className={styles.error}>{error}</p>}
            <button type="button" onClick={handleManagedEnter} className={styles.ssoButton}>
              Enter dashboard
            </button>
          </>
        ) : oidcEnabled ? (
          <>
            {error && <p className={styles.error}>{error}</p>}
            <button type="button" onClick={handleSSOLogin} className={styles.ssoButton}>
              Sign in with SSO
            </button>
          </>
        ) : (
          <form onSubmit={handleLogin} className={styles.form}>
            <label htmlFor="token">Service Account Token</label>
            <textarea
              id="token"
              rows={5}
              placeholder="eyJhbGciOiJSUzI1NiIsImtpZCI6..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            {error && <p className={styles.error}>{error}</p>}
            <button type="submit" disabled={!token.trim() || loading}>
              {loading ? "Verifying…" : "Sign in"}
            </button>
          </form>
        )}

        {oidcEnabled === false && !selectedClusterManaged && (
          <p className={styles.hint}>
            Generate a token with:<br />
            <code>kubectl create token &lt;service-account&gt; -n &lt;namespace&gt;</code>
          </p>
        )}
      </div>
    </main>
  );
}
