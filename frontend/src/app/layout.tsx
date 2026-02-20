import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KubeAdjust",
  description: "Kubernetes resource limits & requests dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
