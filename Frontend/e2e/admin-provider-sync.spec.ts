import { test, expect } from "@playwright/test";
import { API, ADMIN_CAPABILITIES, json, record, signInAsAdmin, type Sent } from "./admin-harness";

/**
 * Rotating a provider credential and disconnecting somebody else's account.
 *
 * Both routes existed, tested, for some time with nothing able to press them:
 * `admin-queries.ts` never mentioned either, so the capability resolved, the
 * route worked, and an operator had no way in. Rotation is the worse of the
 * two — the refresh machinery ran only as a side effect of a sync that
 * happened to find an expired token, so somebody who suspected a leaked
 * credential could not act on the suspicion.
 *
 * These assert on what leaves the browser. A button that looks like it fired
 * and never reached the server is exactly the failure a screenshot hides, and
 * it is the one this pair of controls is most likely to have.
 */

const account = {
  id: "ca-1",
  provider: "GMAIL",
  email: "dana@acme.test",
  status: "ACTIVE",
  lastSyncedAt: new Date().toISOString(),
  lastErrorCode: null,
  membership: { user: { email: "dana@acme.test", displayName: "Dana" } },
};

async function openProviderSync(
  page: import("@playwright/test").Page,
  opts: { capabilities?: string[]; rotateFails?: boolean } = {}
): Promise<Sent[]> {
  const sent: Sent[] = [];
  await signInAsAdmin(page, { capabilities: opts.capabilities });

  await page.route(`${API}/connectors/admin`, (route) =>
    route.fulfill(json({ accounts: [account] }))
  );
  await page.route(`${API}/connectors/dead-letter`, (route) =>
    route.fulfill(json({ events: [] }))
  );

  await page.route(`${API}/connectors/admin/*/rotate`, (route) => {
    if (opts.rotateFails) {
      const request = route.request();
      sent.push({ method: request.method(), url: request.url(), body: null });
      return route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: {
            code: "PROVIDER_ERROR",
            message: "Could not rotate that credential: the provider refused the refresh.",
          },
        }),
      });
    }
    return record(sent, route, { id: account.id, provider: "GMAIL", rotatedAt: new Date().toISOString() });
  });

  await page.route(`${API}/connectors/admin/*`, (route) => {
    // The list endpoint shares this prefix; only a DELETE is the disconnect.
    if (route.request().method() !== "DELETE") return route.fallback();
    return record(sent, route, { id: account.id });
  });

  await page.goto("/admin/provider-sync");
  await expect(page.getByRole("heading", { name: "Provider sync" })).toBeVisible();
  return sent;
}

test.describe("admin provider sync", () => {
  test("rotates a credential through step-up and tells the server", async ({ page }) => {
    const sent = await openProviderSync(page);

    await page.getByRole("button", { name: "Rotate" }).click();
    await page.waitForTimeout(500);

    const rotate = sent.find((s) => s.url.includes("/rotate"));
    expect(rotate, "the Rotate button must reach /connectors/admin/:id/rotate").toBeTruthy();
    expect(rotate!.method).toBe("POST");
  });

  test("names the account it is about to disconnect, and only disconnects on confirm", async ({
    page,
  }) => {
    const sent = await openProviderSync(page);

    await page.getByRole("button", { name: "Disconnect" }).first().click();
    // The dialog names whose account this is — "Disconnect this account?" is
    // not a question anyone can answer. Scoped to the dialog because the row
    // behind it carries the same name.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(/Dana|dana@acme\.test/);

    // Nothing has been sent yet: the dialog is a decision point, not a delay.
    expect(sent.filter((s) => s.method === "DELETE")).toHaveLength(0);

    await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
    await page.waitForTimeout(500);

    const removed = sent.find((s) => s.method === "DELETE");
    expect(removed, "confirming must send the tenant-scope disconnect").toBeTruthy();
    // The member's own-account route would not reach anybody else's.
    expect(removed!.url).toContain("/connectors/admin/");
  });

  test("shows the provider's refusal rather than reporting success", async ({ page }) => {
    await openProviderSync(page, { rotateFails: true });

    await page.getByRole("button", { name: "Rotate" }).click();

    // A rotation that failed is the case an operator chasing a suspected leak
    // most needs to see; swallowing it would tell them the credential moved
    // when it did not.
    await expect(page.getByText(/Could not rotate that credential/)).toBeVisible();
  });

  test("offers neither control to an admin without the capabilities", async ({ page }) => {
    await openProviderSync(page, {
      capabilities: ADMIN_CAPABILITIES.filter(
        (c) => c !== "connector.credentials.rotate" && c !== "connector.tenant.disconnect"
      ),
    });

    // Disabled rather than absent, with the reason in the title — the screen
    // says what is missing instead of pretending the action does not exist.
    await expect(page.getByRole("button", { name: "Rotate" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Disconnect" })).toBeDisabled();
  });
});
