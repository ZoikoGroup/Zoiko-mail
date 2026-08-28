import { OAuth2Client } from "google-auth-library";
import { env } from "../../config/env.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";

export interface GoogleUserInfo {
  googleId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  picture?: string;
}

export async function verifyGoogleToken(idToken: string): Promise<GoogleUserInfo> {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new AppError("Google OAuth is not configured on the server", 500, ErrorCodes.INTERNAL_ERROR);
  }

  const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);

  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_ID,
    });
    
    const payload = ticket.getPayload();
    if (!payload) {
      throw new AppError("Invalid Google ID token payload", 401, ErrorCodes.UNAUTHORIZED);
    }
    
    if (!payload.email_verified) {
      throw new AppError("Google account email is not verified", 401, ErrorCodes.UNAUTHORIZED);
    }
    
    return {
      googleId: payload.sub,
      email: payload.email!.toLowerCase(),
      name: payload.name || "Google User",
      emailVerified: true,
      picture: payload.picture,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Failed to verify Google token", 401, ErrorCodes.UNAUTHORIZED);
  }
}
