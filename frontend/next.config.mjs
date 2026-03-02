/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          // Content-Security-Policy is set per-request by src/middleware.ts
          // (nonce-based, replaces the static unsafe-inline/unsafe-eval policy)
        ],
      },
    ];
  },
};

export default nextConfig;
