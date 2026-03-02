import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "KubeAdjust",
  description: "Kubernetes resource limits & requests dashboard",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en">
      <head>
        {nonce && <meta name="x-nonce" content={nonce} />}
      </head>
      <body>{children}</body>
    </html>
  );
}
