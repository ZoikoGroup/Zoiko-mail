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

  it("lets any origin see that the API is up, and only through /api/health", async () => {
    // The web app tells "API down" from "API refusing this page" with a
    // no-cors probe of /api/health, which only works if this one endpoint
    // is readable cross-origin. Everything else keeps helmet's same-origin.
    const health = await request(app).get("/api/health").expect(200);
    expect(health.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(Object.keys(health.body.data).sort()).toEqual(["status", "timestamp"]);
    const ready = await request(app).get("/api/ready").expect(200);
    expect(ready.headers["cross-origin-resource-policy"]).toBe("same-origin");
  });

  it("allows both spellings of the local frontend by default", () => {
    // localhost and 127.0.0.1 are different origins to a browser; allowing
    // one only made the other fail every request as "Unable to reach".
    const defaults = "http://localhost:3000,http://127.0.0.1:3000".split(",");
    if (!process.env.CORS_ORIGIN) expect(env.CORS_ORIGIN.split(",")).toEqual(defaults);
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
    expect(response.text).toContain("zoiko_provider_events_pending");
    expect(response.text).toContain("zoiko_provider_events_dead_letter");
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
