import { OAuth2Client } from "google-auth-library";
import { env } from "../../config/env.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";

/**
 * Verifies a Google ID token (the `credential` from Google Identity Services)
 * against Google's published signing keys.
 *
 * Why no client secret: the secret authenticates our server when exchanging an
 * authorization code. We never exchange a code — we verify a signature Google
 * already produced. The `audience` check below is what makes that safe: it
 * rejects a token that is validly signed but was issued for a different app.
 */

let client: OAuth2Client | null = null;

function getClient(): OAuth2Client {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new AppError("Google login is not configured", 500, ErrorCodes.INTERNAL_ERROR);
  }
  client ??= new OAuth2Client(env.GOOGLE_CLIENT_ID);
  return client;
}

export interface GoogleProfile {
  providerUserId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}

export async function verifyGoogleIdToken(credential: string): Promise<GoogleProfile> {
  let payload;
  try {
    const ticket = await getClient().verifyIdToken({
      idToken: credential,
      audience: env.GOOGLE_CLIENT_ID!,
    });
    payload = ticket.getPayload();
  } catch {
    throw new AppError("Invalid Google credential", 401, ErrorCodes.TOKEN_INVALID);
  }

  if (!payload?.sub || !payload.email) {
    throw new AppError("Google credential is missing required claims", 401, ErrorCodes.TOKEN_INVALID);
  }

  // Google itself tells us whether the address is confirmed. Skipping this
  // would let anyone create a Google account claiming an address they don't
  // control and then link to a local account with the same email.
  if (payload.email_verified !== true) {
    throw new AppError("Your Google email address is not verified", 401, ErrorCodes.EMAIL_NOT_VERIFIED);
  }

  if (env.GOOGLE_ALLOWED_HD && payload.hd !== env.GOOGLE_ALLOWED_HD) {
    throw new AppError("This Google account's domain is not permitted", 403, ErrorCodes.FORBIDDEN);
  }

  return {
    providerUserId: payload.sub,
    email: payload.email.toLowerCase(),
    displayName: payload.name?.trim() || payload.email.split("@")[0]!,
    avatarUrl: payload.picture ?? null,
  };
}