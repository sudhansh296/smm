export interface AccessTokenPayload {
  sub: string; // User.id
  isAdmin: boolean;
  iat: number;
  exp: number;
}

export interface RegisterInput {
  email: string;
  displayName: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
  totpCode?: string | undefined;
}

export interface AuthTokens {
  accessToken: string;
  expiresIn: number; // seconds
}

export interface PasswordResetInput {
  token: string;
  password: string;
}

export interface TotpEnrollResponse {
  secret: string;
  qrCodeUri: string;
  backupCodes: string[];
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  isAdmin: boolean;
  totpEnabled: boolean;
  walletBalance: string; // USD as string with 8 dp
  walletBalanceInr: string; // INR equivalent as string with 2 dp
  createdAt: string;
}
