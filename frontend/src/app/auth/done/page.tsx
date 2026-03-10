"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * /auth/done — transient client-side page that finalises the OIDC login.
 * Reads the session token from the short-lived kubeadjust-token-init cookie,
 * moves it to sessionStorage under the correct key, clears the cookie,
 * then redirects to the dashboard.
 */
export default function AuthDone() {
  const router = useRouter();

  useEffect(() => {
    const match = document.cookie.match(/kubeadjust-token-init=([^;]+)/);
    if (!match) {
      router.replace("/?error=auth_failed");
      return;
    }

    const token = decodeURIComponent(match[1]);

    try {
      const cluster = sessionStorage.getItem("kube-cluster") ?? "";
      const key = cluster ? `kube-token:${cluster}` : "kube-token";
      sessionStorage.setItem(key, token);
    } catch {
      // sessionStorage unavailable — can't persist the session token
      router.replace("/?error=auth_failed");
      return;
    }

    // Clear the transfer cookie
    document.cookie = "kubeadjust-token-init=; Max-Age=0; Path=/auth/done";

    router.replace("/dashboard");
  }, [router]);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
      <p style={{ color: "var(--fg-muted, #888)", fontFamily: "monospace" }}>Authenticating…</p>
    </div>
  );
}
