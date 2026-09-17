import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authHeader, registerUser } from "./helpers.js";
import { SNIPPET_LENGTH } from "../src/modules/message/message.utils.js";

const app = createApp();

/**
 * List endpoints return metadata and a snippet, never a message body.
 *
 * API §9 and §13, API-007, SEC-008, DG-003 and AC-011 all state this, and
 * every list surface used to violate it: `GET /mail`, `GET /messages` and
 * `GET /threads` each returned complete message bodies. A folder of 25
 * messages shipped 25 whole emails so the client could draw subject lines
 * and paperclip icons.
 *
 * The assertions look for the body text anywhere in the serialized response
 * rather than at a known path. A body leaking through some nested relation is
 * exactly the failure that a field-by-field check misses.
 */

/**
 * A body long enough that its snippet is a real truncation.
 *
 * The first version of these tests used a short body and asserted the marker
 * was absent from the response — which failed, correctly. A snippet of a
 * 74-character body *is* that body, and §9 permits a short snippet. So the
 * marker has to sit beyond the cut: `BODY_LEAD` is what a snippet may show,
 * and `BODY_TAIL` is what must never leave the server through a list.
 */
const BODY_LEAD = "Opening line about the quarterly settlement";
const BODY_TAIL = "CONFIDENTIAL-TAIL-MARKER-four-hundred-thousand-pounds";
const SECRET_BODY = `${BODY_LEAD} ${"filler ".repeat(60)}${BODY_TAIL}`;

async function sendMessageTo(
  fromToken: string,
  recipients: { to: string[]; cc?: string[]; bcc?: string[] },
  body: { subject: string; textBody?: string; htmlBody?: string }
) {
  const draft = await request(app)
    .post("/api/v1/mail/drafts")
    .set(authHeader(fromToken))
    .send({ ...body, recipients })
    .expect(201);
  await request(app)
    .post(`/api/v1/mail/drafts/${draft.body.data.id}/send`)
    .set(authHeader(fromToken))
    .expect(200);
  return draft.body.data.id as string;
}

/** A member of the owner's workspace, with a mailbox and a session. */
async function memberOf(owner: { accessToken: string; tenantId: string }, email: string) {
  const member = await registerUser(app, { email });
  await request(app)
    .post("/api/v1/membership/members")
    .set(authHeader(owner.accessToken))
    .send({ email, role: "MEMBER" })
    .expect(201);
  const login = await request(app)
    .post("/api/v1/auth/login")
    .send({ email, password: member.password, tenantId: owner.tenantId })
    .expect(200);
  const session = login.body.data.session ?? login.body.data;
  return { ...member, accessToken: session.accessToken as string };
}

describe("list responses carry no message body", () => {
  it("GET /mail returns a snippet and no body", async () => {
    const owner = await registerUser(app, {
      email: `min-mail-${Date.now()}@zoiko.test`,
    });

    await sendMessageTo(owner.accessToken, { to: ["outside@example.test"] }, {
      subject: "Quarterly settlement",
      textBody: SECRET_BODY,
    });

    const list = await request(app)
      .get("/api/v1/mail?folder=SENT")
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(JSON.stringify(list.body)).not.toContain(BODY_TAIL);
    const row = list.body.data.items[0];
    expect(row.message.textBody).toBeUndefined();
    expect(row.message.htmlBody).toBeUndefined();
    // The metadata the screen actually renders is all still there.
    expect(row.message.subject).toBe("Quarterly settlement");
    expect(row.message.snippet).toContain("Opening line");
    expect(row.message.author.email).toBe(owner.email);
  });

  it("GET /mail/{id} still returns the body, which is where the reader gets it", async () => {
    const owner = await registerUser(app, {
      email: `min-detail-${Date.now()}@zoiko.test`,
    });
    const messageId = await sendMessageTo(
      owner.accessToken,
      { to: ["outside@example.test"] },
      { subject: "Detail read", textBody: SECRET_BODY }
    );

    const detail = await request(app)
      .get(`/api/v1/mail/${messageId}`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    // §13 permits a full body on a detail-by-id read. Minimizing the list is
    // only correct if this still works — otherwise the mail client has no
    // way to show a message at all.
    expect(detail.body.data.message.textBody).toBe(SECRET_BODY);
    // The half a list never sends is reachable here, and only here.
    expect(detail.body.data.message.textBody).toContain(BODY_TAIL);
  });

  it("GET /messages returns no body", async () => {
    const owner = await registerUser(app, {
      email: `min-messages-${Date.now()}@zoiko.test`,
    });
    await sendMessageTo(owner.accessToken, { to: ["outside@example.test"] }, {
      subject: "Messages list",
      textBody: SECRET_BODY,
    });

    const list = await request(app)
      .get("/api/v1/messages")
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(JSON.stringify(list.body)).not.toContain(BODY_TAIL);
    expect(list.body.data.messages[0].snippet).toContain("Opening line");
  });

  it("GET /threads returns no body, only the snippet the row displays", async () => {
    const owner = await registerUser(app, {
      email: `min-threads-${Date.now()}@zoiko.test`,
    });
    await sendMessageTo(owner.accessToken, { to: ["outside@example.test"] }, {
      subject: "Thread preview",
      textBody: SECRET_BODY,
    });

    const list = await request(app)
      .get("/api/v1/threads")
      .set(authHeader(owner.accessToken))
      .expect(200);

    expect(JSON.stringify(list.body)).not.toContain(BODY_TAIL);
    const latest = list.body.data.threads[0].messages[0];
    expect(latest.textBody).toBeUndefined();
    expect(latest.snippet).toContain("Opening line");
  });
});

describe("the snippet", () => {
  it("is capped and marked when the body is longer", async () => {
    const owner = await registerUser(app, {
      email: `min-long-${Date.now()}@zoiko.test`,
    });
    const long = "word ".repeat(400).trim();

    await sendMessageTo(owner.accessToken, { to: ["outside@example.test"] }, {
      subject: "Long body",
      textBody: long,
    });

    const list = await request(app)
      .get("/api/v1/mail?folder=SENT")
      .set(authHeader(owner.accessToken))
      .expect(200);

    const snippet: string = list.body.data.items[0].message.snippet;
    // An ellipsis is added, so the cap is the limit plus that one character.
    expect(snippet.length).toBeLessThanOrEqual(SNIPPET_LENGTH + 1);
    expect(snippet.endsWith("…")).toBe(true);
    expect(long.length).toBeGreaterThan(snippet.length);
  });

  it("reads through HTML when there is no plain-text part", async () => {
    const owner = await registerUser(app, {
      email: `min-html-${Date.now()}@zoiko.test`,
    });

    await sendMessageTo(owner.accessToken, { to: ["outside@example.test"] }, {
      subject: "HTML only",
      htmlBody:
        "<style>p{color:red}</style><p>Invoice&nbsp;attached</p><p>Please review</p>",
    });

    const list = await request(app)
      .get("/api/v1/mail?folder=SENT")
      .set(authHeader(owner.accessToken))
      .expect(200);

    const snippet: string = list.body.data.items[0].message.snippet;
    // Tags and the stylesheet are gone; the readable text survives, and the
    // two paragraphs do not run together into one word.
    expect(snippet).toContain("Invoice attached");
    expect(snippet).toContain("Please review");
    expect(snippet).not.toContain("<p>");
    expect(snippet).not.toContain("color:red");
  });

  it("is null when there is nothing to preview", async () => {
    const owner = await registerUser(app, {
      email: `min-empty-${Date.now()}@zoiko.test`,
    });

    await sendMessageTo(owner.accessToken, { to: ["outside@example.test"] }, {
      subject: "No body at all",
    });

    const list = await request(app)
      .get("/api/v1/mail?folder=SENT")
      .set(authHeader(owner.accessToken))
      .expect(200);

    // Null rather than an empty string, so the client can fall back to the
    // subject instead of rendering a blank preview line.
    expect(list.body.data.items[0].message.snippet).toBeNull();
  });
});

describe("what a list row says about attachments", () => {
  it("reports a flag and a count without naming the files", async () => {
    const owner = await registerUser(app, {
      email: `min-attach-${Date.now()}@zoiko.test`,
    });

    const draft = await request(app)
      .post("/api/v1/mail/drafts")
      .set(authHeader(owner.accessToken))
      .send({ subject: "With attachment", recipients: { to: ["outside@example.test"] } })
      .expect(201);
    await request(app)
      .post(`/api/v1/mail/drafts/${draft.body.data.id}/attachments`)
      .set(authHeader(owner.accessToken))
      .attach("file", Buffer.from("payroll numbers"), {
        filename: "payroll-2026.csv",
        contentType: "text/csv",
      })
      .expect(201);
    await request(app)
      .post(`/api/v1/mail/drafts/${draft.body.data.id}/send`)
      .set(authHeader(owner.accessToken))
      .expect(200);

    const list = await request(app)
      .get("/api/v1/mail?folder=SENT")
      .set(authHeader(owner.accessToken))
      .expect(200);

    const row = list.body.data.items[0];
    expect(row.message.hasAttachments).toBe(true);
    expect(row.message.attachmentCount).toBe(1);
    // §9 allows `has_attachments`, not the attachment list. A filename can be
    // as revealing as the body — this one names a payroll file.
    expect(JSON.stringify(list.body)).not.toContain("payroll-2026.csv");
    expect(row.message.attachments).toBeUndefined();

    // The detail read is where the files are named, so downloads still work.
    const detail = await request(app)
      .get(`/api/v1/mail/${draft.body.data.id}`)
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(detail.body.data.message.attachments[0].fileName).toBe("payroll-2026.csv");
  });
});

describe("minimizing the list did not weaken BCC protection", () => {
  it("hides a blind copy from a recipient who is not the author", async () => {
    const owner = await registerUser(app, {
      email: `min-bcc-owner-${Date.now()}@zoiko.test`,
    });
    const recipient = await memberOf(owner, `min-bcc-to-${Date.now()}@zoiko.test`);

    await sendMessageTo(
      owner.accessToken,
      { to: [recipient.email], bcc: ["hidden-watcher@example.test"] },
      { subject: "Blind copy", textBody: SECRET_BODY }
    );

    const asRecipient = await request(app)
      .get("/api/v1/mail?folder=INBOX")
      .set(authHeader(recipient.accessToken))
      .expect(200);

    expect(JSON.stringify(asRecipient.body)).not.toContain("hidden-watcher@example.test");

    // The author still sees who they blind-copied.
    const asAuthor = await request(app)
      .get("/api/v1/mail?folder=SENT")
      .set(authHeader(owner.accessToken))
      .expect(200);
    expect(JSON.stringify(asAuthor.body)).toContain("hidden-watcher@example.test");
  });
});
