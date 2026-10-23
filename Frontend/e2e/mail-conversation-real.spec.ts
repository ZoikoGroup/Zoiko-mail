import { test, expect, type APIRequestContext } from "@playwright/test";
import { API, signIn, useRealWorkspace } from "./real-harness";

/**
 * A long conversation reads like one, against the real API and database.
 *
 * Seven messages back and forth, as people actually write them: some replies
 * with words of their own, some that only quote, an attachment on the last.
 * Before, every collapsed row and list snippet showed the quoted history
 * ("On … wrote: > …"), and the newest message sat under the reply bar.
 */

const getFixture = useRealWorkspace();
const key = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const SUBJECT = "Re: nervoirevnerovneroivnerovwinerovinervoinerovierv";

async function token(request: APIRequestContext, email: string) {
  const res = await request.post(`${API}/auth/login`, { data: { email, password: getFixture().password, workspace: "MEMBER" } });
  return (await res.json()).data.accessToken as string;
}

test("a seven-message conversation shows each message's own words, folds the middle, and opens on the newest", async ({ browser, request }) => {
  const f = getFixture();
  const a = await token(request, f.sender.address);
  const b = await token(request, f.recipient.address);
  const headers = (t: string) => ({ Authorization: `Bearer ${t}`, "Idempotency-Key": key("conv") });

  const first = await (
    await request.post(`${API}/mail/drafts`, {
      headers: headers(a),
      data: { subject: SUBJECT, textBody: "first message", htmlBody: "<p>first message</p>", recipients: { to: [f.recipient.address] } },
    })
  ).json();
  await request.post(`${API}/mail/drafts/${first.data.id}/send`, { headers: headers(a) });
  let last = first.data.id as string;
  const turns: Array<[string, string]> = [
    [b, "this is replied to you, i have received your email"],
    [a, "got replied mail"],
    [b, ""],
    [a, ""],
    [b, ""],
    [a, "check these files"],
  ];
  for (const [t, text] of turns) {
    const reply = await (
      await request.post(`${API}/mail/${last}/reply`, { headers: headers(t), data: { textBody: text, htmlBody: text ? `<p>${text}</p>` : "<p></p>" } })
    ).json();
    if (text === "check these files") {
      await request.post(`${API}/mail/drafts/${reply.data.id}/attachments`, {
        headers: headers(t),
        multipart: { file: { name: "Plan.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF") } },
      });
    }
    await request.post(`${API}/mail/drafts/${reply.data.id}/send`, { headers: headers(t) });
    last = reply.data.id;
  }

  const { page, context } = await signIn(browser, f.recipient.address, f.password);
  await page.setViewportSize({ width: 1600, height: 900 });

  // The list shows each reply's own words, never the quoted history.
  const list = page.getByRole("region", { name: "Inbox messages" });
  await expect(list.getByText("check these files")).toBeVisible({ timeout: 30_000 });
  await expect(list.getByText(/wrote:/)).toHaveCount(0);

  await list.getByText("check these files").click();
  const conversation = page.getByTestId("conversation");
  await expect(conversation).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("7 messages in this conversation")).toBeVisible();

  // First message, the fold, the last two — and the newest open.
  const fold = conversation.getByRole("button", { name: /^\d+ earlier messages$/ });
  await expect(fold).toHaveText("4 earlier messages");
  const messages = conversation.getByTestId("thread-message");
  await expect(messages).toHaveCount(3);
  const newest = conversation.locator("[data-testid='thread-message'][data-open='true']");
  await expect(newest).toHaveCount(1);
  await expect(newest.frameLocator("iframe[title='Message body']").getByText("check these files")).toBeVisible();
  await expect(newest.getByTestId("attachment-list")).toContainText("Plan.pdf");
  // The quoted history is folded until asked for.
  await expect(newest.getByTestId("quoted-text")).toHaveCount(0);
  // The newest message is scrolled into view, not left under the reply bar.
  await expect(newest).toBeInViewport();

  // Unfolded: every message is a line of its own words; quote-only replies say so.
  await fold.click();
  await expect(messages).toHaveCount(7);
  await expect(conversation.getByText("this is replied to you, i have received your email")).toBeVisible();
  await expect(conversation.getByText("got replied mail")).toBeVisible();
  await expect(conversation.getByText("Quoted the earlier messages")).toHaveCount(3);
  await expect(conversation.getByText(/wrote:/)).toHaveCount(0);

  // "•••" shows the history, each earlier message one level further in.
  await newest.getByRole("button", { name: "Show quoted text" }).click();
  const quoted = newest.getByTestId("quoted-text");
  await expect(quoted.frameLocator("iframe").getByText(/wrote:/).first()).toBeVisible();
  const nesting = await quoted.frameLocator("iframe").locator("blockquote blockquote").count();
  expect(nesting).toBeGreaterThan(0);

  // Reply from the footer answers the newest message.
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  const reply = page.getByRole("dialog", { name: "Reply" });
  await expect(reply.getByLabel("Subject")).toHaveValue(SUBJECT);
  await reply.getByRole("button", { name: "Close" }).click();

  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/conversation.png` });
  await context.close();
});
