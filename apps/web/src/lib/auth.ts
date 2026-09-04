import Cookies from "js-cookie";
import type { UserProfile } from "@nexussmm/types";

export function getAccessToken(): string | undefined {
  return Cookies.get("accessToken");
}

export function setAccessToken(token: string): void {
  Cookies.set("accessToken", token, {
    expires: 1 / 96, // 15 minutes
    sameSite: "strict",
    secure: process.env["NODE_ENV"] === "production",
  });
}

export function removeAccessToken(): void {
  Cookies.remove("accessToken");
}

export function isAuthenticated(): boolean {
  return !!getAccessToken();
}

// Parse JWT payload without verification (verification done server-side)
export function parseTokenPayload(
  token: string,
): { sub: string; isAdmin: boolean; exp: number } | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const decoded = JSON.parse(atob(payload));
    return decoded as { sub: string; isAdmin: boolean; exp: number };
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string): boolean {
  const payload = parseTokenPayload(token);
  if (!payload) return true;
  return Date.now() / 1000 > payload.exp;
}
