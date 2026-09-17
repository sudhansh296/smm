import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/maintenance",
  "/manifest.webmanifest",
];

// Any request for a static file (has a file extension) -- images, favicons,
// manifests, fonts, etc. served from /public or Next's file-based metadata
// conventions (icon.png, etc.). Always bypasses auth, regardless of login
// state -- these aren't pages and were previously getting 307-redirected to
// "/" whenever the requester wasn't authenticated (broke logo/favicon/manifest
// loading on the logged-out landing page).
const STATIC_FILE_RE = /\.[a-zA-Z0-9]+$/;

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (STATIC_FILE_RE.test(pathname)) {
    return NextResponse.next();
  }

  const accessToken  = request.cookies.get("accessToken")?.value;
  const refreshToken = request.cookies.get("refreshToken")?.value;
  const isAuthenticated = !!(accessToken || refreshToken);
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || (p !== "/" && pathname.startsWith(p)));

  // Not authenticated -- redirect to landing page
  if (!isPublic && !isAuthenticated) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Authenticated user on landing page -> dashboard
  if (pathname === "/" && isAuthenticated) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Authenticated on other auth pages -> dashboard
  if (isPublic && isAuthenticated && pathname !== "/" && !pathname.startsWith("/verify-email") && !pathname.startsWith("/reset-password")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|public).*)"],
};