import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL =
  process.env.BACKEND_URL ?? "http://localhost:8080";

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
  const target = `${BACKEND_URL}/api/${path.join("/")}${req.nextUrl.search}`;
  const headers = new Headers();

  const auth = req.headers.get("authorization");
  if (auth) headers.set("Authorization", auth);
  headers.set("Accept", "application/json");

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
    });

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Backend unavailable" },
      { status: 502 },
    );
  }
}
