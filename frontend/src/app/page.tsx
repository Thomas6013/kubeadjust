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
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (selectedCluster) sessionStorage.setItem("kube-cluster", selectedCluster);
      await api.verify(token.trim());
      sessionStorage.setItem("kube-token", token.trim());
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.container}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>⎈</span>
          <h1>KubeAdjust</h1>
        </div>
        <p className={styles.subtitle}>Resource limits &amp; requests dashboard</p>

        <form onSubmit={handleLogin} className={styles.form}>
          {clusters.length > 1 && (
            <>
              <label htmlFor="cluster">Cluster</label>
              <select
                id="cluster"
                value={selectedCluster}
                onChange={(e) => setSelectedCluster(e.target.value)}
              >
                {clusters.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </>
          )}
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

        <p className={styles.hint}>
          Generate a token with:<br />
          <code>kubectl create token &lt;service-account&gt; -n &lt;namespace&gt;</code>
        </p>
      </div>
    </main>
  );
}
