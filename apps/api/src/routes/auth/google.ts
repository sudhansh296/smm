import type { FastifyInstance } from "fastify";
import oauth2Plugin from "@fastify/oauth2";
import {
  generateRefreshToken,
  hashRefreshToken,
} from "../../services/auth.service.js";

export default async function googleAuthRoute(fastify: FastifyInstance) {
  const clientId     = process.env["GOOGLE_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_CLIENT_SECRET"];
  const callbackUrl  = process.env["GOOGLE_CALLBACK_URL"] ?? "http://localhost:3001/auth/google/callback";
  const frontendUrl  = process.env["FRONTEND_URL"] ?? "http://localhost:3000";

  // Skip if Google OAuth not configured
  if (!clientId || !clientSecret || clientId === "placeholder" || clientSecret === "placeholder") {
    fastify.log.warn("[google-auth] Google OAuth not configured -- skipping");
    return;
  }

  // Register OAuth2 plugin
  // startRedirectPath is relative to this plugin's prefix (/auth), so /google -> /auth/google
  await fastify.register(oauth2Plugin, {
    name:        "googleOAuth2",
    scope:       ["profile", "email"],
    credentials: {
      client: { id: clientId, secret: clientSecret },
      auth:   oauth2Plugin.GOOGLE_CONFIGURATION,
    },
    startRedirectPath: "/google",
    callbackUri:       callbackUrl,  // full URL from env, e.g. http://localhost:3001/auth/google/callback
    pkce:              "S256",
  });

  // Callback endpoint -- Google redirects here (registered under /auth prefix -> /auth/google/callback)
  fastify.get("/google/callback", async (request, reply) => {
    try {
      const tokenResponse = await (fastify as any).googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);
      const accessToken   = tokenResponse.token.access_token as string;

      // Get user profile from Google
      const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!userInfoRes.ok) throw new Error("Failed to fetch Google user info");

      const googleUser = await userInfoRes.json() as {
        id: string; email: string; name: string;
        picture?: string; verified_email: boolean;
      };

      if (!googleUser.email || !googleUser.id) throw new Error("Missing email/id from Google");

      const email = googleUser.email.toLowerCase().trim();

      // Find or create user
      let user = await fastify.prisma.user.findUnique({ where: { email } });

      if (user) {
        if (user.isSuspended) return reply.redirect(`${frontendUrl}/login?error=suspended`);

        const linked = await fastify.prisma.oAuthAccount.findUnique({
          where: { provider_providerUserId: { provider: "google", providerUserId: googleUser.id } },
        });

        if (!linked) {
          // If user registered with email+password, don't silently link Google
          if (user.passwordHash) {
            return reply.redirect(`${frontendUrl}/login?error=email_exists`);
          }
          await fastify.prisma.oAuthAccount.create({
            data: { userId: user.id, provider: "google", providerUserId: googleUser.id },
          });
        }
      } else {
        // Create new user -- email verified status from Google
        user = await fastify.prisma.user.create({
          data: {
            email,
            displayName:    googleUser.name ?? email.split("@")[0],
            emailVerified:  googleUser.verified_email === true,
            oauthAccounts:  {
              create: { provider: "google", providerUserId: googleUser.id },
            },
          },
        });
      }

      // Issue JWT
      const jwtToken = fastify.jwt.sign(
        { sub: user.id, isAdmin: user.isAdmin } as Parameters<typeof fastify.jwt.sign>[0],
      );

      // Issue refresh token
      const rawRefresh = generateRefreshToken();
      const tokenHash  = hashRefreshToken(rawRefresh);
      await fastify.prisma.refreshToken.create({
        data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      });

      // Set HttpOnly cookies
      const isProd = process.env["NODE_ENV"] === "production";
      reply.setCookie("refreshToken", rawRefresh, { httpOnly: true, secure: isProd, sameSite: "strict", path: "/", maxAge: 7 * 24 * 60 * 60 });
      reply.setCookie("accessToken",  jwtToken,   { httpOnly: true, secure: isProd, sameSite: "lax",    path: "/", maxAge: 900 });

      return reply.redirect(`${frontendUrl}/dashboard`);

    } catch (err) {
      fastify.log.error(err, "[google-auth] Callback error");
      return reply.redirect(`${frontendUrl}/login?error=oauth_failed`);
    }
  });
}
