"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * /auth/logout — clears all KubeAdjust session data and redirects to login.
 */
export default function Logout() {
  const router = useRouter();

  useEffect(() => {
    // Clear all KubeAdjust session data
    try {
      const keysToRemove = Object.keys(sessionStorage).filter(
        (k) => k === "kube-token" || k.startsWith("kube-token:") || k === "kube-cluster" || k.startsWith("kubeadjust:"),
      );
      for (const k of keysToRemove) sessionStorage.removeItem(k);
    } catch { /* ignore */ }

    router.replace("/");
  }, [router]);

  return null;
}
