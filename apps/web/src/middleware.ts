import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/",
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