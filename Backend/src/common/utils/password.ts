import bcrypt from "bcrypt";
import { env } from "../../config/env.js";

export async function hashPassword(plainText: string): Promise<string> {
  return bcrypt.hash(plainText, env.BCRYPT_ROUNDS);
}

export async function verifyPassword(
  plainText: string,
  passwordHash: string | null
): Promise<boolean> {
  if (!passwordHash) return false;
  return bcrypt.compare(plainText, passwordHash);
}
