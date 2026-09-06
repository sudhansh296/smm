import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/maintenance",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const accessToken  = request.cookies.get("accessToken")?.value;
  const refreshToken = request.cookies.get("refreshToken")?.value;

  // Consider authenticated if EITHER cookie is present.
  // accessToken is short-lived (15 min); refreshToken is long-lived (7 days).
  // The API /auth/refresh endpoint will renew accessToken when needed.
  // Without this check, users get logged out every 15 min on page refresh.
  const isAuthenticated = !!(accessToken || refreshToken);

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  // Not authenticated -- redirect to login
  if (!isPublic && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Already authenticated -- redirect away from auth pages
  if (isPublic && isAuthenticated && !pathname.startsWith("/verify-email") && !pathname.startsWith("/reset-password")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|public).*)"],
};