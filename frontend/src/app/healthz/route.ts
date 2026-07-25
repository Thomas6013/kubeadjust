/**
 * GET /healthz — liveness/readiness target for the frontend container.
 *
 * Deliberately does no work: the root layout calls headers() for the CSP nonce,
 * which opts every page into per-request rendering, so probing "/" ran a full
 * React server render on every check. Under the container CPU limit that render
 * can exceed the probe deadline while the process is streaming API traffic,
 * restarting a healthy pod. A route handler is not wrapped by the layout, and
 * force-static keeps it out of the dynamic path entirely.
 */
export const dynamic = "force-static";

export function GET() {
  return new Response("ok", {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}
