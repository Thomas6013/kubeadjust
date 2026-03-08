import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8080";

/**
 * GET /auth/callback
 * Receives the OIDC provider redirect with ?code=&state=.
 * Validates state, exchanges the code with the backend, and passes the
 * resulting session token to the client via a short-lived readable cookie.
 * The /auth/done client page moves it to sessionStorage and clears the cookie.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const savedState = req.cookies.get("oidc-state")?.value;

  if (!code || !state || !savedState || state !== savedState) {
    return NextResponse.redirect(new URL("/?error=auth_failed", req.url));
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ code }),
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.redirect(new URL("/?error=auth_failed", req.url));
    }

    const { token } = (await res.json()) as { token: string };

    const response = NextResponse.redirect(new URL("/auth/done", req.url));

    // Pass the session token to the client-side /auth/done page via a short-lived
    // readable cookie (30s). The client immediately moves it to sessionStorage.
    response.cookies.set("kubeadjust-token-init", token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 30,
      path: "/auth/done",
    });

    // Clear the OIDC state cookie
    response.cookies.delete("oidc-state");
    return response;
  } catch {
    return NextResponse.redirect(new URL("/?error=auth_failed", req.url));
  }
}
