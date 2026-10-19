import { test, expect, type Page, type Request } from "@playwright/test";
import { json } from "./admin-harness";

/**
 * Replying and attachments in the Member mail client, in the browser.
 *
 * The API is stubbed. The server's half — who a reply goes to, the quote,
 * includesQuote — is covered by Backend/tests/mailbox.zoiko-store.test.ts.
 * What only a browser shows: the reply window's recipients, subject and
 * quoted original; that a file picked in the composer is really uploaded to
 * the draft before it is sent; and that received attachments show their type,
 * a preview where the browser can show one, and a download.
 */

const ME = "management@temveris.com";
const COLLEAGUE = "info@temveris.com";
const OUTSIDER = "boss@outside.test";

const now = new Date("2026-10-17T10:00:00Z").toISOString();

function attachment(id: string, fileName: string, contentType: string, sizeBytes = 2048) {
  return { id, fileName, contentType, sizeBytes, createdAt: now };
}

// A message management@ sent: the case that used to fail with
// "Reply has no eligible recipient".
const SENT = {
  id: "item-1",
  messageId: "m1",
  folder: "SENT",
  isRead: true,
  isStarred: false,
  createdAt: now,
  updatedAt: now,
  labels: [],
  message: {
    id: "m1",
    subject: "Leave approval",
    textBody: "Please approve my leave.",
    htmlBody: "<p>Please approve my leave.</p>",
    status: "SENT",
    sentAt: now,
    scheduledAt: null,
    threadId: null,
    authorUserId: "u1",
    fromAddress: ME,
    fromName: null,
    createdAt: now,
    recipients: [
      { id: "r1", email: COLLEAGUE, type: "TO", deliveryStatus: "DELIVERED" },
      { id: "r2", email: OUTSIDER, type: "CC", deliveryStatus: "DELIVERED" },
    ],
    attachments: [
      attachment("a-pdf", "policy.pdf", "application/pdf"),
      // Imported mail often labels files generically; the extension still says what it is.
      attachment("a-csv", "days.csv", "application/octet-stream", 40),
      attachment("a-docx", "form.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ],
    author: { id: "u1", email: "sam@temveris.com", displayName: "Sam" },
  },
};

const summary = (item: typeof SENT) => {
  const { textBody: _t, htmlBody: _h, attachments, ...rest } = item.message;
  void _t;
  void _h;
  return {
    ...item,
    message: { ...rest, snippet: "Please approve my leave.", updatedAt: now, hasAttachments: true, attachmentCount: attachments.length },
  };
};

const draft = (id: string) => ({ ...SENT, id: `item-${id}`, messageId: id, folder: "DRAFTS", message: { ...SENT.message, id, status: "DRAFT", attachments: [] } });

interface Calls {
  all: Array<{ method: string; path: string; body: unknown }>;
}

/** Signs in to the Member workspace and stubs the mail API around one Sent message. */
async function openMail(page: Page): Promise<Calls> {
  const calls: Calls = { all: [] };
  let uploads = 0;
  await page.route(
    (url) => url.pathname.startsWith("/api/v1/"),
    async (route) => {
      const request: Request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace("/api/v1", "");
      const method = request.method();
      let body: unknown = null;
      try {
        body = request.postDataJSON();
      } catch {
        body = request.postData() ? "(multipart)" : null;
      }
      calls.all.push({ method, path, body });

      const session = {
        accessToken: "stub-access-token",
        refreshToken: "stub-refresh-token",
        expiresIn: "12h",
        user: { id: "u1", email: "sam@temveris.com", displayName: "Sam" },
        tenant: { id: "t1", name: "Temveris", planCode: "starter" },
        membership: { id: "m1", role: "MEMBER" },
        workspace: "MEMBER",
      };
      if (path === "/auth/login") return route.fulfill(json({ state: "SIGNED_IN", session, ...session }));
      if (path === "/auth/me")
        return route.fulfill(json({ ...session.user, tenant: session.tenant, membership: session.membership, workspace: "MEMBER" }));
      if (path === "/mail/send-as")
        return route.fulfill(json({ mailboxes: [{ id: "mb1", address: ME, type: "USER", shared: false, sendSuspended: false }] }));
      if (path === "/mail/signature") return route.fulfill(json({ signature: null }));
      if (path === "/mail/mailbox") return route.fulfill(json({ id: "mb1", address: ME }));
      if (path === "/mail" && method === "GET")
        return route.fulfill(json({ items: [summary(SENT)], pagination: { folder: "SENT", starredOnly: false, page: 1, limit: 25, total: 1, totalPages: 1 } }));
      if (path === "/mail/m1" && method === "GET") return route.fulfill(json(SENT));
      if ((path === "/mail/m1/reply" || path === "/mail/m1/reply-all") && method === "POST") return route.fulfill(json(draft("d1")));
      if (path === "/mail/drafts/d1" && method === "PATCH") return route.fulfill(json(draft("d1")));
      if (path === "/mail/drafts/d1/attachments" && method === "POST") {
        uploads += 1;
        return route.fulfill(json(attachment(`up-${uploads}`, "leave-form.pdf", "application/pdf", 18)));
      }
      if (path === "/mail/drafts/d1/send") return route.fulfill(json({ ...draft("d1"), status: "SENT" }));
      if (path === "/mail/m1/attachments/a-csv")
        return route.fulfill({ status: 200, contentType: "application/octet-stream", body: "name,days\nSam,3\n" });
      if (path.startsWith("/mail/m1/attachments/"))
        return route.fulfill({ status: 200, contentType: "application/pdf", body: "%PDF-1.4\n%%EOF\n" });
      return route.fulfill(json({ items: [], count: 0, counts: {}, labels: [] }));
    }
  );

  await page.goto("/login/member");
  await page.getByPlaceholder("john@example.com").fill(ME);
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In to Member Workspace" }).click();
  await expect(page).toHaveURL(/\/mail$/, { timeout: 60_000 });
  await page.getByText("Leave approval").first().click();
  await expect(page.getByRole("button", { name: "Reply", exact: true }).or(page.getByTitle("Reply", { exact: true })).first()).toBeVisible({ timeout: 60_000 });
  return calls;
}

test("replying to a message I sent addresses the people it went to, with Re: and the quoted original", async ({ page }) => {
  await openMail(page);
  await page.getByTitle("Reply", { exact: true }).click();

  const dialog = page.getByRole("dialog", { name: "Reply" });
  await expect(dialog).toBeVisible();
  // Not "Reply has no eligible recipient": the reply goes to info@, and plain
  // Reply leaves the Cc out.
  await expect(dialog.getByTestId("compose-to")).toContainText(COLLEAGUE);
  await expect(dialog.getByTestId("compose-to")).not.toContainText(ME);
  await expect(dialog.getByTestId("compose-cc")).not.toContainText(OUTSIDER);
  await expect(dialog.getByLabel("Subject")).toHaveValue("Re: Leave approval");

  const quote = dialog.getByTestId("compose-quote");
  await expect(quote).toContainText(`${ME} wrote:`);
  await quote.getByRole("button").click();
  await expect(quote).toContainText("Please approve my leave.");
});

test("Reply all adds the original Cc", async ({ page }) => {
  await openMail(page);
  await page.getByTitle("Reply all", { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Reply all" });
  await expect(dialog.getByTestId("compose-to")).toContainText(COLLEAGUE);
  await expect(dialog.getByTestId("compose-cc")).toContainText(OUTSIDER);
});

test("a file attached to a reply is uploaded to the draft before it is sent, once", async ({ page }) => {
  const calls = await openMail(page);
  await page.getByTitle("Reply", { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Reply" });

  await dialog.locator(".ProseMirror").click();
  await page.keyboard.type("Approved, form attached.");
  await dialog.getByTestId("compose-file-input").setInputFiles({
    name: "leave-form.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
  });
  await expect(dialog.getByTestId("compose-attachments")).toContainText("leave-form.pdf");
  await expect(dialog.getByTestId("compose-attachments").getByTestId("file-type-badge")).toContainText("PDF");

  // Let autosave create the draft first — the path where files used to be dropped.
  await expect.poll(() => calls.all.filter((c) => c.path === "/mail/drafts/d1/attachments").length, { timeout: 20_000 }).toBe(1);
  await dialog.getByRole("button", { name: "Send", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  const paths = calls.all.map((c) => `${c.method} ${c.path}`);
  expect(paths.filter((p) => p === "POST /mail/m1/reply")).toHaveLength(1);
  expect(paths.filter((p) => p === "POST /mail/drafts/d1/attachments")).toHaveLength(1);
  expect(paths.lastIndexOf("POST /mail/drafts/d1/attachments")).toBeLessThan(paths.indexOf("POST /mail/drafts/d1/send"));

  const created = calls.all.find((c) => c.path === "/mail/m1/reply")!.body as Record<string, unknown>;
  expect(created.includesQuote).toBe(true);
  const saved = calls.all.filter((c) => c.method === "PATCH" && c.path === "/mail/drafts/d1").pop()!.body as {
    recipients: { to: string[] };
    subject: string;
    textBody: string;
  };
  expect(saved.recipients.to).toEqual([COLLEAGUE]);
  expect(saved.subject).toBe("Re: Leave approval");
  expect(saved.textBody).toContain("Approved, form attached.");
  expect(saved.textBody).toMatch(new RegExp(`${ME} wrote:\\n> Please approve my leave\\.`));
});

test("sending straight away, before autosave, still uploads the file first", async ({ page }) => {
  const calls = await openMail(page);
  await page.getByTitle("Reply", { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Reply" });
  await dialog.getByTestId("compose-file-input").setInputFiles({
    name: "leave-form.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
  });
  await dialog.getByRole("button", { name: "Send", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  const paths = calls.all.map((c) => `${c.method} ${c.path}`);
  expect(paths.filter((p) => p === "POST /mail/m1/reply")).toHaveLength(1);
  expect(paths.filter((p) => p === "POST /mail/drafts/d1/attachments")).toHaveLength(1);
  expect(paths.indexOf("POST /mail/drafts/d1/attachments")).toBeLessThan(paths.indexOf("POST /mail/drafts/d1/send"));
});

test("received attachments show their type, preview what the browser can show, and download", async ({ page }) => {
  await openMail(page);
  const list = page.getByTestId("attachment-list");
  await expect(list).toContainText("3 attachments");
  const cards = list.getByTestId("attachment-card");
  await expect(cards).toHaveCount(3);
  await expect(cards.filter({ hasText: "policy.pdf" }).getByTestId("file-type-badge")).toHaveText("PDF");
  await expect(cards.filter({ hasText: "days.csv" }).getByTestId("file-type-badge")).toHaveText("CSV");
  await expect(cards.filter({ hasText: "form.docx" }).getByTestId("file-type-badge")).toHaveText("DOCX");
  await expect(cards.filter({ hasText: "form.docx" })).toContainText("No preview, download to open");
  await expect(cards.filter({ hasText: "form.docx" }).getByRole("button", { name: "Preview form.docx" })).toHaveCount(0);

  // A CSV labelled application/octet-stream still previews, as a table.
  await page.getByRole("button", { name: "Preview days.csv" }).last().click();
  const preview = page.getByRole("dialog", { name: "Preview of days.csv" });
  await expect(preview.getByTestId("text-preview")).toContainText("Sam");
  await expect(preview.locator("table td").first()).toHaveText("name");
  await page.keyboard.press("Escape");

  // PDF previews in a frame.
  await page.getByRole("button", { name: "Preview policy.pdf" }).last().click();
  await expect(page.getByRole("dialog", { name: "Preview of policy.pdf" }).locator("iframe")).toBeVisible();
  await page.keyboard.press("Escape");

  // Download hands over the file under its own name.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download form.docx" }).click();
  expect((await download).suggestedFilename()).toBe("form.docx");
});
