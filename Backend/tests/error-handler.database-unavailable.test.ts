import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { errorHandler, isDatabaseUnavailable } from "../src/common/middleware/errorHandler.js";

/**
 * A database outage reaches the client as a retryable 503 in plain words, not
 * as Prisma's message — which names the host, the port and a source file, and
 * which the sign-in form used to print verbatim.
 */

const unreachable = () =>
  new Prisma.PrismaClientInitializationError(
    "Can't reach database server at `localhost:55432`",
    "6.19.3",
    "P1001"
  );

function appThrowing(error: unknown) {
  const app = express();
  app.get("/boom", () => {
    throw error;
  });
  app.use(errorHandler);
  return app;
}

describe("database unavailable", () => {
  it("recognises connection failures and pool timeouts, not ordinary query errors", () => {
    expect(isDatabaseUnavailable(unreachable())).toBe(true);
    expect(
      isDatabaseUnavailable(
        new Prisma.PrismaClientKnownRequestError("Timed out fetching a new connection", { code: "P2024", clientVersion: "6.19.3" })
      )
    ).toBe(true);
    expect(
      isDatabaseUnavailable(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "6.19.3" })
      )
    ).toBe(false);
    expect(isDatabaseUnavailable(new Error("anything else"))).toBe(false);
  });

  it("answers 503 with a plain message and none of Prisma's details", async () => {
    const response = await request(appThrowing(unreachable())).get("/boom").expect(503);
    expect(response.body.error.code).toBe("DATABASE_UNAVAILABLE");
    expect(response.body.error.message).toBe(
      "Zoiko Mail can't reach its database right now. Please try again in a moment."
    );
    expect(JSON.stringify(response.body)).not.toMatch(/55432|prisma|\.ts/i);
  });
});
