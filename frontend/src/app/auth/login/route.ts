import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

/**
 * GET /auth/login
 * Fetches the OIDC authorization URL from the backend, stores the state in a
 * short-lived httpOnly cookie, then redirects the browser to the OIDC provider.
 */
function publicOrigin(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(/:$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  const origin = publicOrigin(req);
  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/loginurl`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.redirect(new URL("/?error=oidc_unavailable", origin));
    }

    const { authUrl, state } = (await res.json()) as { authUrl: string; state: string };

    const response = NextResponse.redirect(authUrl);
    response.cookies.set("oidc-state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 300, // 5 minutes — enough for the OIDC round-trip
      path: "/",
    });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/?error=oidc_unavailable", origin));
  }
}
