"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api, type ClusterItem } from "@/lib/api";
import styles from "./login.module.css";

export default function LoginPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [clusters, setClusters] = useState<ClusterItem[]>([]);
  const [selectedCluster, setSelectedCluster] = useState("");
  const [oidcEnabled, setOidcEnabled] = useState(false);

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
    api.authConfig().then((cfg) => setOidcEnabled(cfg.oidcEnabled));

    // Show error from OIDC redirect if present
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (err) setError(err === "auth_failed" ? "Authentication failed. Please try again." : "OIDC provider unavailable.");
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (selectedCluster) sessionStorage.setItem("kube-cluster", selectedCluster);
      await api.verify(token.trim());
      const tokenKey = selectedCluster ? `kube-token:${selectedCluster}` : "kube-token";
      sessionStorage.setItem(tokenKey, token.trim());
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
          <span className={styles.logoIcon}>⎈</span>
          <h1>KubeAdjust</h1>
        </div>
        <p className={styles.subtitle}>Resource limits &amp; requests dashboard</p>

        {clusters.length > 0 && (
          <>
            <label>Cluster</label>
            <div className={styles.clusterGrid}>
              {clusters.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  className={`${styles.clusterCard} ${selectedCluster === c.name ? styles.clusterCardActive : ""}`}
                  onClick={() => setSelectedCluster(c.name)}
                >
                  <span className={styles.clusterIcon}>⎈</span>
                  {c.name}
                </button>
              ))}
            </div>
          </>
        )}

        {oidcEnabled ? (
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

        {!oidcEnabled && (
          <p className={styles.hint}>
            Generate a token with:<br />
            <code>kubectl create token &lt;service-account&gt; -n &lt;namespace&gt;</code>
          </p>
        )}
      </div>
    </main>
  );
}
