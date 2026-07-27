import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";

const app = createApp();

describe("Production runtime foundation", () => {
  it("returns request IDs and hardened HTTP headers", async () => {
    const response = await request(app)
      .get("/api/health")
      .set("X-Request-Id", "runtime-test-request")
      .expect(200);

    expect(response.headers["x-request-id"]).toBe("runtime-test-request");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("reports database readiness", async () => {
    const response = await request(app).get("/api/ready").expect(200);
    expect(response.body.data).toMatchObject({
      status: "READY",
      database: "UP",
      attachmentStorage: "UP",
      exportStorage: "UP",
    });
  });

  it("protects and exposes Prometheus operational metrics", async () => {
    await request(app).get("/api/metrics").expect(401);
    const response = await request(app).get("/api/metrics")
      .set("x-operations-key", env.OPERATIONS_KEY)
      .expect(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.text).toContain("zoiko_http_requests_total");
    expect(response.text).toContain("zoiko_background_jobs_pending");
    expect(response.text).not.toContain(env.OPERATIONS_KEY);
  });

  it("compresses sufficiently large responses when requested", async () => {
    const response = await request(app)
      .get("/api/docs.json")
      .set("Accept-Encoding", "gzip")
      .expect(200);
    expect(response.headers["content-encoding"]).toBe("gzip");
  });
});
