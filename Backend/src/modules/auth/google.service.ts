import { env } from "../../config/env.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { logger } from "../../config/logger.js";

/**
 * Google as an identity provider.
 *
 * The flow is authorization-code, exchanged server-side:
 *
 *   browser → Google popup → single-use code → our API → Google token endpoint
 *   → access token → Google userinfo → verified email
 *
 * The client never hands us a token to trust. It hands us a code, which is
 * useless without the client secret we hold, and we exchange it ourselves over
 * TLS directly with Google. That is why this file contains no JWT verification
 * and pulls in no JWKS library: there is no third-party assertion to validate,
 * only Google's own answer to our own request.
 *
 * Deliberately *not* the implicit / ID-token-in-the-browser variant. That would
 * mean accepting a token minted for someone else's audience unless every claim
 * were checked against Google's rotating keys — the exact class of mistake that
 * makes social sign-in a vulnerability rather than a feature.
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

/** Scopes requested by the client. Identity only — no mail access. */
export const GOOGLE_SIGNIN_SCOPES = ["openid", "email", "profile"] as const;

export interface GoogleIdentity {
  /** Google's stable subject id. Never the email, which can be reassigned. */
  subject: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
}

export function isGoogleSignInConfigured(): boolean {
  return Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET);
}

function assertConfigured(): { clientId: string; clientSecret: string } {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new AppError(
      "Google sign-in is not configured on this server",
      503,
      ErrorCodes.FEATURE_DISABLED
    );
  }
  return {
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
  };
}

/** Fails closed on anything unexpected, and never logs the code or tokens. */
async function postForm(url: string, body: Record<string, string>): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!response.ok) {
    // Google's error body can echo request parameters, so it is not logged.
    logger.warn({ status: response.status, url }, "Google token exchange rejected");
    throw new AppError(
      "Google sign-in could not be completed",
      401,
      ErrorCodes.UNAUTHORIZED
    );
  }
  return response.json();
}

/**
 * Exchanges a single-use authorization code for the signed-in person's identity.
 *
 * `redirectUri` must match what the browser used. The Google Identity Services
 * popup code flow uses the literal "postmessage" rather than a URL, which is
 * why it is a parameter instead of a configured constant.
 */
export async function resolveGoogleIdentity(
  code: string,
  redirectUri = "postmessage"
): Promise<GoogleIdentity> {
  const { clientId, clientSecret } = assertConfigured();

  const token = (await postForm(TOKEN_ENDPOINT, {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  })) as { access_token?: string };

  if (!token.access_token) {
    throw new AppError("Google sign-in could not be completed", 401, ErrorCodes.UNAUTHORIZED);
  }

  const profileResponse = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!profileResponse.ok) {
    throw new AppError("Google sign-in could not be completed", 401, ErrorCodes.UNAUTHORIZED);
  }

  const profile = (await profileResponse.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };

  if (!profile.sub || !profile.email) {
    throw new AppError("Google returned an incomplete profile", 401, ErrorCodes.UNAUTHORIZED);
  }

  // An unverified Google address proves possession of an account, not of the
  // mailbox. Accepting it would let anyone who can create a Google account
  // claiming someone else's address sign in as them.
  if (profile.email_verified !== true) {
    throw new AppError(
      "This Google account has no verified email address",
      401,
      ErrorCodes.EMAIL_NOT_VERIFIED
    );
  }

  return {
    subject: profile.sub,
    email: profile.email.toLowerCase(),
    emailVerified: true,
    displayName: profile.name?.trim() || null,
  };
}
