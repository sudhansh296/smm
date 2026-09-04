// Re-export the JWT user type so all routes can use it without re-importing
export interface JwtUser {
  sub: string;
  isAdmin: boolean;
  iat: number;
  exp: number;
}
