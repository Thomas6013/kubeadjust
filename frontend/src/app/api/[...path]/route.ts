import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL =
  process.env.BACKEND_URL ?? "http://localhost:8080";

// Upper bound on a single backend call. The backend retries K8s requests up to
// 3 times with a 15s client timeout, so a slow API server can keep a request in
// flight for ~45s per call and minutes on the fan-out endpoints. Without a
// ceiling those requests accumulate in this process until undici's 300s default.
const BACKEND_TIMEOUT_MS = 30_000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return proxy(req, path);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return proxy(req, path);
}

async function proxy(req: NextRequest, path: string[]) {
  const joined = path.join("/");
  if (joined.includes("..") || joined.includes("//") || joined.includes("\0")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  const target = `${BACKEND_URL}/api/${joined}${req.nextUrl.search}`;
  const headers = new Headers();

  const auth = req.headers.get("authorization");
  if (auth) headers.set("Authorization", auth);
  const cluster = req.headers.get("x-cluster");
  if (cluster) headers.set("X-Cluster", cluster);
  // Forward the session cookie in OIDC mode so the backend can validate the session.
  const sessionCookie = req.cookies.get("kubeadjust-session");
  if (sessionCookie) headers.set("Cookie", `kubeadjust-session=${sessionCookie.value}`);
  headers.set("Accept", "application/json");

  // Abort the upstream call when the client goes away (tab closed, navigation,
  // auto-refresh superseding an in-flight request) or when the budget expires.
  const signal = AbortSignal.any([
    req.signal,
    AbortSignal.timeout(BACKEND_TIMEOUT_MS),
  ]);

  const body =
    req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined;

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      signal,
      // Streaming a request body requires declaring the stream half-duplex;
      // undici throws without it, which the catch below would surface as a
      // misleading "Backend unavailable" 502.
      ...(body ? { duplex: "half" } : {}),
    } as RequestInit);

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch (err) {
    // Client disconnected — nobody is listening, so the status is only for logs.
    if (req.signal.aborted) {
      return new NextResponse(null, { status: 499 });
    }
    if (err instanceof Error && err.name === "TimeoutError") {
      return NextResponse.json(
        { error: "Backend timeout" },
        { status: 504 },
      );
    }
    return NextResponse.json(
      { error: "Backend unavailable" },
      { status: 502 },
    );
  }
}
