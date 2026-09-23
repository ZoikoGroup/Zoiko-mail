import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";

const app = createApp();

/**
 * Cursor pagination on the admin lists — API Specification §4.
 *
 * Members, domains and policies were unbounded `findMany` calls. That is not a
 * bug anybody sees on a workspace of twelve people; it is a bug the first
 * large customer sees, as a screen that used to be instant timing out, with no
 * error and no log line to find. So the property under test is not "pagination
 * exists" but "the endpoint cannot be made to return everything".
 *
 * Cursor rather than offset because §4 says so, and because offset over a
 * growing table shifts rows between requests — page two repeats or skips.
 */

async function workspace(suffix: string) {
  return registerUser(app, { email: `pg-${suffix}@zoiko.test` });
}

const listDomains = (token: string, q = "") =>
  request(app).get(`/api/v1/domains${q}`).set(authHeader(token));

describe("admin list pagination", () => {
  it("bounds a list that asks for no limit", async () => {
    const owner = await workspace("bound");
    for (let i = 0; i < 4; i++) {
      await request(app)
        .post("/api/v1/domains")
        .set(authHeader(owner.accessToken))
        .send({ domainName: `bound-${i}-${Date.now()}.test` })
        .expect(201);
    }

    const res = await listDomains(owner.accessToken).expect(200);
    // The array keeps its name — every existing caller reads `domains`, and a
    // page object under that key would render as an empty table, not an error.
    expect(Array.isArray(res.body.data.domains)).toBe(true);
    expect(res.body.data).toHaveProperty("nextCursor");
  });

  it("returns exactly the page asked for, and a cursor when more remain", async () => {
    const owner = await workspace("page");
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/api/v1/domains")
        .set(authHeader(owner.accessToken))
        .send({ domainName: `page-${i}-${Date.now()}.test` })
        .expect(201);
    }

    const first = await listDomains(owner.accessToken, "?limit=2").expect(200);
    expect(first.body.data.domains).toHaveLength(2);
    expect(first.body.data.nextCursor).toBeTruthy();
  });

  it("advances without repeating or skipping a row", async () => {
    const owner = await workspace("walk");
    const made: string[] = [];
    for (let i = 0; i < 5; i++) {
      const d = await request(app)
        .post("/api/v1/domains")
        .set(authHeader(owner.accessToken))
        .send({ domainName: `walk-${i}-${Date.now()}.test` })
        .expect(201);
      made.push(d.body.data.id);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const q: string = `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await listDomains(owner.accessToken, q).expect(200);
      seen.push(...res.body.data.domains.map((d: { id: string }) => d.id));
      cursor = res.body.data.nextCursor;
      if (!cursor) break;
    }

    expect(seen).toHaveLength(made.length);
    expect(new Set(seen).size).toBe(made.length); // no repeats
    expect([...seen].sort()).toEqual([...made].sort()); // nothing skipped
  });

  it("stops offering a cursor on the last page", async () => {
    const owner = await workspace("last");
    await request(app)
      .post("/api/v1/domains")
      .set(authHeader(owner.accessToken))
      .send({ domainName: `last-${Date.now()}.test` })
      .expect(201);

    const res = await listDomains(owner.accessToken, "?limit=50").expect(200);
    expect(res.body.data.nextCursor).toBeNull();
  });

  it("refuses a limit past the cap, rather than honouring it", async () => {
    const owner = await workspace("cap");
    // An unbounded limit is the same unbounded query, just spelled by the
    // caller — so it is a 400 and not a silently clamped 200.
    await listDomains(owner.accessToken, "?limit=5000").expect(400);
  });

  it("pages the members list too", async () => {
    const owner = await workspace("members");
    const res = await request(app)
      .get("/api/v1/membership/members?limit=1")
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(Array.isArray(res.body.data.members)).toBe(true);
    expect(res.body.data.members.length).toBeLessThanOrEqual(1);
    expect(res.body.data).toHaveProperty("nextCursor");
  });

  it("pages the policies list too", async () => {
    const owner = await workspace("policies");
    const res = await request(app)
      .get("/api/v1/policies?limit=1")
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(Array.isArray(res.body.data.policies)).toBe(true);
    expect(res.body.data).toHaveProperty("nextCursor");
  });

  it("treats a malformed cursor as a client error, not as page one", async () => {
    const owner = await workspace("bad");
    // Silently restarting would re-serve page one forever while the caller
    // believed it was advancing — an infinite list that looks like it works.
    // It is also not a 500: the request was wrong, not the server.
    const res = await listDomains(owner.accessToken, "?cursor=bm90LWEtdXVpZA");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
