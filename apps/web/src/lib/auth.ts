// Access token is now an HttpOnly cookie set by the server.
// It is NOT accessible from JS  --  the browser sends it automatically via withCredentials.
// These stubs are kept for backward compatibility but are no-ops for the cookie-based flow.

export function getAccessToken(): string | undefined {
  // HttpOnly cookie  --  not readable from JS. Returns undefined.
  return undefined;
}

export function setAccessToken(_token: string): void {
  // No-op: access token is set as HttpOnly cookie by the server.
}

export function removeAccessToken(): void {
  // No-op: access token cookie is cleared by the server on logout.
}

export function isAuthenticated(): boolean {
  // Cannot read HttpOnly cookie from JS.
  // Use the user object from the auth store instead.
  return false;
}
