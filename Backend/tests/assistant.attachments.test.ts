import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/config/prisma.js";
import { withCrossTenant } from "../src/config/tenantScope.js";
import { setAssistantModelForTests, type ChatPart, type ChatTurn } from "../src/modules/assistant/assistant.model.js";
import { assistantService } from "../src/modules/assistant/assistant.service.js";
import { authHeader, loginUser, registerUser } from "./helpers.js";

const app = createApp();

/**
 * Files attached to assistant questions: what is accepted, what the model is
 * actually given, and that files stay their owner's and are cleaned up. The
 * model is a stand-in that records its input; the real model reads these
 * same files in the browser test.
 */

const fixture = (name: string) => readFileSync(resolve(__dirname, "fixtures", name));
const storagePath = (key: string) => resolve(process.cwd(), env.ASSISTANT_STORAGE_PATH, key);

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

function fakeModel() {
  const calls: ChatTurn[][] = [];
  setAssistantModelForTests({
    async answer(_system, turns) {
      calls.push(turns);
      return { content: "Read it.", model: "test-model", promptTokens: 1, completionTokens: 1 };
    },
  });
  return calls;
}
afterEach(() => setAssistantModelForTests(null));

async function member() {
  const owner = await registerUser(app, { email: `af-owner-${uid()}@zoiko.test` });
  const user = await registerUser(app, { email: `af-member-${uid()}@zoiko.test` });
  await request(app).post("/api/v1/membership/members").set(authHeader(owner.accessToken)).send({ email: user.email, role: "MEMBER" }).expect(201);
  const login = await loginUser(app, user.email, user.password, owner.tenantId, user.mfaSecret);
  return { token: login.accessToken as string, tenantId: owner.tenantId };
}

const upload = (token: string, name: string, data: Buffer) =>
  request(app).post("/api/v1/assistant/attachments").set(authHeader(token)).attach("file", data, name);
const ask = (token: string, body: object) => request(app).post("/api/v1/assistant/messages").set(authHeader(token)).send(body);

const textOf = (turn: ChatTurn) =>
  typeof turn.content === "string" ? turn.content : (turn.content as ChatPart[]).filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");
const imagesOf = (turn: ChatTurn) =>
  typeof turn.content === "string" ? [] : (turn.content as ChatPart[]).filter((p) => p.type === "image_url");

describe("uploading", () => {
  it("reads PDF, DOCX and DOC text, and keeps images", async () => {
    const { token } = await member();
    const pdf = (await upload(token, "Quarterly Plan.pdf", fixture("Quarterly Plan.pdf")).expect(201)).body.data;
    expect(pdf).toMatchObject({ kind: "DOCUMENT", contentType: "application/pdf", pageCount: 1, truncated: false });
    const docx = (await upload(token, "Quarterly Plan.docx", fixture("Quarterly Plan.docx")).expect(201)).body.data;
    expect(docx).toMatchObject({ kind: "DOCUMENT" });
    const doc = (await upload(token, "Legacy Notes.doc", fixture("Legacy Notes.doc")).expect(201)).body.data;
    expect(doc).toMatchObject({ kind: "DOCUMENT", contentType: "application/msword" });
    const png = (await upload(token, "Chart.png", fixture("Chart.png")).expect(201)).body.data;
    expect(png).toMatchObject({ kind: "IMAGE", contentType: "image/png" });
    const jpg = (await upload(token, "Site photo.jpg", fixture("Site photo.jpg")).expect(201)).body.data;
    expect(jpg).toMatchObject({ kind: "IMAGE", contentType: "image/jpeg" });

    // The extracted text is kept; the document's bytes are not.
    const stored = await withCrossTenant(() => prisma.assistantAttachment.findUniqueOrThrow({ where: { id: pdf.id } }));
    expect(stored.extractedText).toContain("Milestone one: design review on 3 November");
    expect(stored.storageKey).toBeNull();
    expect(stored.expiresAt).not.toBeNull();
  });

  it("refuses other types, renamed files, empty files and files over the limit", async () => {
    const { token } = await member();
    expect((await upload(token, "run.exe", Buffer.from("MZ...")).expect(415)).body.error.message).toContain("PDF, Word");
    await upload(token, "notes.txt", Buffer.from("hello")).expect(415);
    // A text file named .pdf, and a PNG named .jpg, are what their bytes say.
    expect((await upload(token, "fake.pdf", Buffer.from("not really a pdf")).expect(415)).body.error.message).toContain("isn't a valid PDF");
    await upload(token, "chart.jpg", fixture("Chart.png")).expect(415);
    await upload(token, "empty.pdf", Buffer.alloc(0)).expect(422);
    await upload(token, "big.png", Buffer.concat([fixture("Chart.png"), Buffer.alloc(env.ASSISTANT_ATTACHMENT_MAX_BYTES)])).expect(413);
    await request(app).post("/api/v1/assistant/attachments").set(authHeader(token)).field("x", "y").expect(400);
  });

  it("explains a PDF with no text", async () => {
    const { token } = await member();
    const blank = Buffer.from(
      "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF"
    );
    const res = await upload(token, "scan.pdf", blank).expect(422);
    expect(res.body.error.message).toMatch(/no selectable text|couldn't be read/);
  });
});

describe("asking about files", () => {
  it("gives the model the document's text and the image itself, and saves which files were asked about", async () => {
    const calls = fakeModel();
    const { token } = await member();
    const pdf = (await upload(token, "Quarterly Plan.pdf", fixture("Quarterly Plan.pdf")).expect(201)).body.data;
    const png = (await upload(token, "Chart.png", fixture("Chart.png")).expect(201)).body.data;

    const reply = (await ask(token, { content: "When is the design review?", attachmentIds: [pdf.id, png.id] }).expect(200)).body.data;
    const turn = calls[0]![calls[0]!.length - 1]!;
    expect(textOf(turn)).toContain("When is the design review?");
    expect(textOf(turn)).toContain("<<<FILE: Quarterly Plan.pdf (document, 1 page)>>>");
    expect(textOf(turn)).toContain("[Page 1]");
    expect(textOf(turn)).toContain("design review on 3 November");
    const images = imagesOf(turn) as { image_url: { url: string } }[];
    expect(images).toHaveLength(1);
    expect(images[0]!.image_url.url).toMatch(/^data:image\/png;base64,iVBOR/);

    expect(reply.messages[0].attachments.map((a: { fileName: string }) => a.fileName)).toEqual(["Quarterly Plan.pdf", "Chart.png"]);
    const thread = (await request(app).get(`/api/v1/assistant/conversations/${reply.conversation.id}`).set(authHeader(token)).expect(200)).body.data;
    expect(thread.messages[0].attachments).toHaveLength(2);

    // Sent once: the same upload cannot be attached again.
    await ask(token, { content: "Again", attachmentIds: [pdf.id] }).expect(409);

    // The image is served back to its owner, as the image it is.
    const image = await request(app).get(`/api/v1/assistant/attachments/${png.id}/content`).set(authHeader(token)).expect(200);
    expect(image.headers["content-type"]).toBe("image/png");
    expect(image.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("answers files sent without words, and remembers a document in follow-ups", async () => {
    const calls = fakeModel();
    const { token } = await member();
    const docx = (await upload(token, "Quarterly Plan.docx", fixture("Quarterly Plan.docx")).expect(201)).body.data;
    const first = (await ask(token, { attachmentIds: [docx.id] }).expect(200)).body.data;
    expect(first.messages[0].content).toMatch(/summarise the key points/);
    expect(first.conversation.title).toBe("Quarterly Plan.docx");

    await ask(token, { conversationId: first.conversation.id, content: "What is milestone one?" }).expect(200);
    const followUp = calls[1]!;
    expect(followUp.map((t) => t.role)).toEqual(["user", "assistant", "user"]);
    expect(textOf(followUp[0]!)).toContain("design review on 3 November");
  });

  it("keeps files to the person who uploaded them", async () => {
    fakeModel();
    const a = await member();
    const b = await member();
    const png = (await upload(a.token, "Chart.png", fixture("Chart.png")).expect(201)).body.data;
    await ask(b.token, { content: "What is this?", attachmentIds: [png.id] }).expect(409);
    await request(app).get(`/api/v1/assistant/attachments/${png.id}/content`).set(authHeader(b.token)).expect(404);
    await request(app).delete(`/api/v1/assistant/attachments/${png.id}`).set(authHeader(b.token)).expect(404);
  });
});

describe("cleaning up", () => {
  it("removes an upload before sending, and an image's file with its conversation", async () => {
    fakeModel();
    const { token } = await member();
    const unsent = (await upload(token, "Chart.png", fixture("Chart.png")).expect(201)).body.data;
    const unsentKey = (await withCrossTenant(() => prisma.assistantAttachment.findUniqueOrThrow({ where: { id: unsent.id } }))).storageKey!;
    expect(existsSync(storagePath(unsentKey))).toBe(true);
    await request(app).delete(`/api/v1/assistant/attachments/${unsent.id}`).set(authHeader(token)).expect(204);
    expect(existsSync(storagePath(unsentKey))).toBe(false);

    const sent = (await upload(token, "Site photo.jpg", fixture("Site photo.jpg")).expect(201)).body.data;
    const key = (await withCrossTenant(() => prisma.assistantAttachment.findUniqueOrThrow({ where: { id: sent.id } }))).storageKey!;
    const chat = (await ask(token, { content: "Describe it", attachmentIds: [sent.id] }).expect(200)).body.data.conversation;
    expect(existsSync(storagePath(key))).toBe(true);
    await request(app).delete(`/api/v1/assistant/conversations/${chat.id}`).set(authHeader(token)).expect(204);
    expect(existsSync(storagePath(key))).toBe(false);
    expect(await withCrossTenant(() => prisma.assistantAttachment.count({ where: { id: sent.id } }))).toBe(0);
  });

  it("purges uploads never sent once they expire", async () => {
    const { token } = await member();
    const png = (await upload(token, "Chart.png", fixture("Chart.png")).expect(201)).body.data;
    const row = await withCrossTenant(() =>
      prisma.assistantAttachment.update({ where: { id: png.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    );
    expect(await withCrossTenant(() => assistantService.purgeExpired())).toBeGreaterThanOrEqual(1);
    expect(existsSync(storagePath(row.storageKey!))).toBe(false);
    expect(await withCrossTenant(() => prisma.assistantAttachment.count({ where: { id: png.id } }))).toBe(0);
  });
});
