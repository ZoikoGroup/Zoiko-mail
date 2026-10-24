import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { authHeader, loginUser, registerUser } from "./helpers.js";

const app = createApp();

/**
 * Contacts (Member workspace → Contacts).
 *
 * A person's contacts are their own. One they mark SHARED is readable by the
 * whole workspace but stays theirs to change. The directory lists colleagues;
 * Other Contacts and a contact's recent activity come from the caller's own
 * mailbox and calendar only.
 */

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

type Person = { email: string; token: string; tenantId: string };

async function workspace(): Promise<{ owner: Person; join: (name?: string) => Promise<Person> }> {
  const reg = await registerUser(app, { email: `ct-owner-${uid()}@zoiko.test`, displayName: "Olive Owner" });
  const owner: Person = { email: reg.email, token: reg.accessToken as string, tenantId: reg.tenantId };
  const join = async (name = "Mo Member") => {
    const user = await registerUser(app, { email: `ct-member-${uid()}@zoiko.test`, displayName: name });
    await request(app).post("/api/v1/membership/members").set(authHeader(owner.token)).send({ email: user.email, role: "MEMBER" }).expect(201);
    const login = await loginUser(app, user.email, user.password, owner.tenantId, user.mfaSecret);
    return { email: user.email, token: login.accessToken as string, tenantId: owner.tenantId };
  };
  return { owner, join };
}

const get = (p: Person, path: string) => request(app).get(`/api/v1/contacts${path}`).set(authHeader(p.token));
const post = (p: Person, path: string, body: object) => request(app).post(`/api/v1/contacts${path}`).set(authHeader(p.token)).send(body);
const patch = (p: Person, path: string, body: object) => request(app).patch(`/api/v1/contacts${path}`).set(authHeader(p.token)).send(body);
const del = (p: Person, path: string) => request(app).delete(`/api/v1/contacts${path}`).set(authHeader(p.token));

async function send(from: Person, to: string[], subject: string) {
  const draft = await request(app).post("/api/v1/mail/drafts").set(authHeader(from.token))
    .send({ subject, textBody: "Hello", recipients: { to } }).expect(201);
  await request(app).post(`/api/v1/mail/drafts/${draft.body.data.id}/send`).set(authHeader(from.token));
}

describe("own contacts", () => {
  it("creates, reads, edits, favourites and deletes a contact", async () => {
    const { owner } = await workspace();
    const created = (await post(owner, "", {
      firstName: "Sarah", lastName: "Chen", email: "Sarah.Chen@Example.com", phone: "+44 20 7946 0000",
      company: "Example Corporation", jobTitle: "Product Director", tags: ["Colleagues"],
    }).expect(201)).body.data;
    expect(created).toMatchObject({ email: "sarah.chen@example.com", owned: true, visibility: "PERSONAL", source: "MANUAL", isFavorite: false });

    const edited = (await patch(owner, `/${created.id}`, { isFavorite: true, phone: null, jobTitle: "VP Product" }).expect(200)).body.data;
    expect(edited).toMatchObject({ isFavorite: true, phone: null, jobTitle: "VP Product" });

    const favourites = (await get(owner, "?scope=favorites").expect(200)).body.data;
    expect(favourites.items.map((c: { id: string }) => c.id)).toEqual([created.id]);

    const summary = (await get(owner, "/summary").expect(200)).body.data;
    expect(summary).toMatchObject({ all: 1, mine: 1, shared: 0, favorites: 1, groups: [{ name: "Colleagues", count: 1 }] });

    await del(owner, `/${created.id}`).expect(204);
    await get(owner, `/${created.id}`).expect(404);
  });

  it("refuses a bad email or phone, and a second contact with the same email", async () => {
    const { owner } = await workspace();
    await post(owner, "", { email: "not-an-email" }).expect(400);
    await post(owner, "", { email: "a@example.com", phone: "call me" }).expect(400);
    await post(owner, "", { email: "a@example.com" }).expect(201);
    const dup = await post(owner, "", { email: "A@example.com" }).expect(409);
    expect(dup.body.error.code).toBe("CONFLICT");
  });

  it("searches across name, company and title and sorts by company", async () => {
    const { owner } = await workspace();
    await post(owner, "", { firstName: "Zed", email: "zed@a.com", company: "Acme" }).expect(201);
    await post(owner, "", { firstName: "Amy", email: "amy@b.com", company: "Bridgepoint", jobTitle: "Partnerships" }).expect(201);
    expect((await get(owner, "?q=partner").expect(200)).body.data.items.map((c: { email: string }) => c.email)).toEqual(["amy@b.com"]);
    expect((await get(owner, "?sort=name").expect(200)).body.data.items.map((c: { email: string }) => c.email)).toEqual(["amy@b.com", "zed@a.com"]);
    expect((await get(owner, "?sort=company").expect(200)).body.data.items.map((c: { email: string }) => c.email)).toEqual(["zed@a.com", "amy@b.com"]);
  });

  it("requires an Idempotency-Key on writes", async () => {
    const { owner } = await workspace();
    await request(app).post("/api/v1/contacts").set(authHeader(owner.token)).set("x-test-omit-idempotency-key", "1")
      .send({ email: "k@example.com" }).expect(400);
  });
});

describe("privacy between people", () => {
  it("keeps personal contacts private and lets the workspace read, not change, a shared one", async () => {
    const { owner, join } = await workspace();
    const colleague = await join();
    const personal = (await post(owner, "", { email: "private@example.com" }).expect(201)).body.data;
    const shared = (await post(owner, "", { email: "vendor@example.com", visibility: "SHARED", isFavorite: true }).expect(201)).body.data;

    await get(colleague, `/${personal.id}`).expect(404);
    const seen = (await get(colleague, `/${shared.id}`).expect(200)).body.data;
    expect(seen).toMatchObject({ owned: false, ownerName: "Olive Owner", isFavorite: false });

    const all = (await get(colleague, "?scope=all").expect(200)).body.data.items.map((c: { email: string }) => c.email);
    expect(all).toEqual(["vendor@example.com"]);
    expect((await get(colleague, "?scope=mine").expect(200)).body.data.items).toHaveLength(0);

    await patch(colleague, `/${shared.id}`, { company: "Changed" }).expect(403);
    await del(colleague, `/${shared.id}`).expect(403);
    await del(colleague, `/${personal.id}`).expect(404);
  });

  it("lists colleagues in the directory, marking the ones already saved", async () => {
    const { owner, join } = await workspace();
    const colleague = await join("Priya Shah");
    const directory = (await get(owner, "/directory").expect(200)).body.data;
    expect(directory).toEqual([expect.objectContaining({ name: "Priya Shah", email: colleague.email, savedContactId: null })]);
    const saved = (await post(owner, "", { email: colleague.email }).expect(201)).body.data;
    expect((await get(owner, "/directory?q=priya").expect(200)).body.data[0].savedContactId).toBe(saved.id);
    expect((await get(colleague, "/directory").expect(200)).body.data.map((d: { email: string }) => d.email)).toEqual([owner.email]);
  });
});

describe("from one's own mail", () => {
  it("offers people one has written to as Other Contacts, and shows recent mail with a contact", async () => {
    const { owner, join } = await workspace();
    const colleague = await join();
    await send(owner, [colleague.email, "client@outside.example"], "Product delivery check-in");

    // A colleague is in the directory, so only the outside address is "other".
    const other = (await get(owner, "/other").expect(200)).body.data;
    expect(other).toEqual([expect.objectContaining({ email: "client@outside.example", messageCount: 1 })]);

    const activity = (await get(owner, `/activity?email=${encodeURIComponent(colleague.email)}`).expect(200)).body.data;
    expect(activity.messages).toEqual([expect.objectContaining({ subject: "Product delivery check-in", folder: "SENT" })]);

    // The colleague's received copy is theirs; the owner's view never reads it.
    const theirs = (await get(colleague, `/activity?email=${encodeURIComponent(owner.email)}`).expect(200)).body.data;
    expect(theirs.messages).toEqual([expect.objectContaining({ folder: "INBOX" })]);

    await post(owner, "", { email: "client@outside.example", source: "MAIL" }).expect(201);
    expect((await get(owner, "/other").expect(200)).body.data).toHaveLength(0);
  });
});

describe("import, duplicates and merge", () => {
  it("imports good rows and reports the others", async () => {
    const { owner } = await workspace();
    await post(owner, "", { email: "existing@example.com" }).expect(201);
    const result = (await post(owner, "/import", {
      contacts: [
        { firstName: "New", email: "new@example.com", tags: ["Clients"] },
        { email: "bad" },
        { email: "existing@example.com" },
        { email: "NEW@example.com" },
      ],
    }).expect(200)).body.data;
    expect(result.created).toBe(1);
    expect(result.skipped.map((s: { row: number }) => s.row)).toEqual([2, 3, 4]);
    const imported = (await get(owner, "?q=new").expect(200)).body.data.items[0];
    expect(imported).toMatchObject({ source: "IMPORT", tags: ["Clients"] });
  });

  it("finds contacts with the same name and merges them into one", async () => {
    const { owner } = await workspace();
    const a = (await post(owner, "", { firstName: "James", lastName: "Wilson", email: "james@work.com", tags: ["A"] }).expect(201)).body.data;
    const b = (await post(owner, "", { firstName: "james", lastName: "wilson", email: "jw@home.com", phone: "+1 555 010 0000", tags: ["B"] }).expect(201)).body.data;
    const groups = (await get(owner, "/duplicates").expect(200)).body.data;
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe("NAME");

    const merged = (await post(owner, "/merge", { keepId: a.id, mergeIds: [b.id] }).expect(200)).body.data;
    expect(merged).toMatchObject({ email: "james@work.com", phone: "+1 555 010 0000" });
    expect(merged.tags.sort()).toEqual(["A", "B"]);
    await get(owner, `/${b.id}`).expect(404);
    expect((await get(owner, "/duplicates").expect(200)).body.data).toHaveLength(0);
  });
});
