import { describe, expect, it } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";

/**
 * Previews of a legacy Word .doc — the one supported document type a browser
 * cannot draw — for a stored attachment and for a file still in the composer.
 * The fixture was written by Microsoft Word, so this reads a real document.
 */

const app = createApp();
const DOC = readFileSync(path.join(__dirname, "fixtures", "Legacy Notes.doc"));
const DOCX = readFileSync(path.join(__dirname, "fixtures", "Quarterly Plan.docx"));

async function draftWithAttachment(name: string, body: Buffer, type: string) {
  const owner = await registerUser(app, { email: `preview-${Date.now()}-${Math.random().toString(16).slice(2)}@zoiko.test` });
  const draft = await request(app)
    .post("/api/v1/mail/drafts")
    .set(authHeader(owner.accessToken))
    .send({ subject: "Preview", recipients: { to: ["someone@example.test"] } })
    .expect(201);
  const uploaded = await request(app)
    .post(`/api/v1/mail/drafts/${draft.body.data.id}/attachments`)
    .set(authHeader(owner.accessToken))
    .attach("file", body, { filename: name, contentType: type })
    .expect(201);
  return { owner, draftId: draft.body.data.id as string, attachmentId: uploaded.body.data.id as string };
}

describe("attachment previews for Word .doc files", () => {
  it("previews a stored .doc as its text", async () => {
    const { owner, draftId, attachmentId } = await draftWithAttachment("Legacy Notes.doc", DOC, "application/msword");
    const res = await request(app)
      .get(`/api/v1/mail/${draftId}/attachments/${attachmentId}/preview`)
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(res.body.data.kind).toBe("text");
    expect(res.body.data.text).toContain("Quarterly Plan Q4");
    expect(res.body.data.text).toContain("Milestone two: launch on 1 December.");
    expect(res.body.data.truncated).toBe(false);
  });

  it("previews a .doc still in the composer, without storing it", async () => {
    const owner = await registerUser(app, { email: `preview-up-${Date.now()}@zoiko.test` });
    const res = await request(app)
      .post("/api/v1/mail/attachments/preview")
      .set(authHeader(owner.accessToken))
      .attach("file", DOC, { filename: "Legacy Notes.doc", contentType: "application/octet-stream" })
      .expect(200);
    expect(res.body.data.text).toContain("Milestone one: design review on 3 November.");
  });

  it("refuses another reader, and says when a file can't be previewed here", async () => {
    const { draftId, attachmentId } = await draftWithAttachment("Legacy Notes.doc", DOC, "application/msword");
    const outsider = await registerUser(app, { email: `preview-out-${Date.now()}@zoiko.test` });
    await request(app)
      .get(`/api/v1/mail/${draftId}/attachments/${attachmentId}/preview`)
      .set(authHeader(outsider.accessToken))
      .expect(404);

    const docx = await draftWithAttachment("Quarterly Plan.docx", DOCX, "application/octet-stream");
    // .docx is drawn in the browser; the server only reads .doc.
    await request(app)
      .get(`/api/v1/mail/${docx.draftId}/attachments/${docx.attachmentId}/preview`)
      .set(authHeader(docx.owner.accessToken))
      .expect(415);

    const broken = await draftWithAttachment("Broken.doc", Buffer.from("not really a word file"), "application/msword");
    const res = await request(app)
      .get(`/api/v1/mail/${broken.draftId}/attachments/${broken.attachmentId}/preview`)
      .set(authHeader(broken.owner.accessToken))
      .expect(422);
    expect(res.body.error.message).toMatch(/couldn't be read/);
  });
});
