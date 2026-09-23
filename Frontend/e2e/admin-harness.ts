import { expect, type Page, type Route } from "@playwright/test";

/**
 * Signing in as an Admin, once.
 *
 * Every admin spec stubbed the same session, capability list and sign-in
 * sequence by hand. Eight copies of a thing that has to agree is how they
 * drift — one spec learns that capabilities moved to `/users/me/capabilities`
 * and the others keep passing against a shape the app no longer sends.
 */

export const API = "**/api/v1";

export const json = (data: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ success: true, data }),
});

/** A refusal shaped the way the real error handler shapes one. */
export const deny = (code: string, message: string, details?: unknown) => ({
  status: 403,
  contentType: "application/json",
  body: JSON.stringify({ success: false, error: { code, message, details }, requestId: "e2e" }),
});

/** What an Admin holds. Pass a narrower list to test a control being hidden. */
export const ADMIN_CAPABILITIES = [
  "people.read",
  "people.invite.member",
  "people.member.manage",
  "workspace.settings.read",
  "workspace.settings.write",
  "workspace.mailboxes.manage",
  "workspace.mailboxes.delete",
  "workspace.mailboxes.sending",
  "workspace.domains.manage",
  "workspace.groups.manage",
  "connector.credentials.rotate",
  "connector.tenant.disconnect",
  "mailbox.delegate",
  "policy.write",
  "audit.read",
  "security-alert.read",
  "security-alert.review",
  "data.export",
];

export interface Sent {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

/**
 * Sign in and land on /admin with every request stubbed.
 *
 * Returns the list the specs assert against: these tests care about what the
 * browser *sends*, because a screen that renders a decision and never tells
 * the server looks perfectly correct in a screenshot.
 */
export async function signInAsAdmin(
  page: Page,
  opts: { capabilities?: string[] } = {}
): Promise<Sent[]> {
  const sent: Sent[] = [];

  // Catch-all first; the specific routes below win by being registered later.
  await page.route(`${API}/**`, (route) => route.fulfill(json({ items: [], count: 0 })));

  const session = {
    accessToken: "stub-access-token",
    refreshToken: "stub-refresh-token",
    expiresIn: "12h",
    user: { id: "u1", email: "admin@zoiko.test", displayName: "Admin" },
    tenant: { id: "t1", name: "Acme Corp", planCode: "starter" },
    membership: { id: "m1", role: "ADMIN" },
    workspace: "ADMIN",
  };

  await page.route(`${API}/auth/login`, (route) =>
    route.fulfill(json({ state: "SIGNED_IN", session, ...session }))
  );
  await page.route(`${API}/auth/me`, (route) =>
    route.fulfill(
      json({
        ...session.user,
        tenant: session.tenant,
        membership: session.membership,
        workspace: "ADMIN",
      })
    )
  );
  await page.route(`${API}/users/me/capabilities`, (route) =>
    route.fulfill(json({ capabilities: opts.capabilities ?? ADMIN_CAPABILITIES, decisions: [] }))
  );
  // Step-up is a real dialog on several of these screens; without it the
  // retry never happens and the assertion reads as "the button did nothing".
  await page.route(`${API}/auth/step-up`, (route) =>
    route.fulfill(json({ stepUpToken: "stub-step-up-token" }))
  );

  await page.goto("/login");
  await page.getByPlaceholder("john@example.com").fill("admin@zoiko.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 60_000 });

  return sent;
}

/** Record a call and answer it, so a spec can assert on what was sent. */
export function record(sent: Sent[], route: Route, body: unknown = { ok: true }) {
  const request = route.request();
  sent.push({
    method: request.method(),
    url: request.url(),
    body: (request.postDataJSON?.() as Record<string, unknown> | undefined) ?? null,
  });
  return route.fulfill(json(body));
}
