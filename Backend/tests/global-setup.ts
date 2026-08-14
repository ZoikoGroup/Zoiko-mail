import { execSync } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

export function setup(): void {
  loadEnv({ path: resolve(process.cwd(), ".env") });

  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  } else if (
    process.env.DATABASE_URL &&
    !process.env.DATABASE_URL.includes("_test")
  ) {
    process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
      /\/zoiko_mail(\?|$)/,
      "/zoiko_mail_test$1"
    );
  } else if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL =
      "postgresql://postgres:postgres@localhost:5432/zoiko_mail_test?schema=public";
  }

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });
}
