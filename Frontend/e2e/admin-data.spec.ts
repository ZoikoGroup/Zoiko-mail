import { test, expect, type Page } from "@playwright/test";
import { API, ADMIN_CAPABILITIES, json, record, signInAsAdmin, type Sent } from "./admin-harness";

/**
 * Export and deletion from the Admin console — PRD §16, RBAC §2.
 *
 * This screen could not exist while the lifecycle router was
 * `requireRole("OWNER")` across its whole surface: `data.export` resolved
 * perfectly in the Admin matrix row and then met a router that had already
 * refused. Nobody builds UI for a guaranteed 403, which is why the gap looked
 * like a missing feature and was really a missing gate.
 *
 * Two properties are worth pinning. Requesting is not deciding — an Admin may
 * raise a deletion, only an Owner may approve it, so this screen has no
 * approve button at all. And "By policy" is a distinct refusal from "you may
 * not": an Admin who reads a flat Forbidden goes asking for a capability they
 * already hold.
 */

const requests = [
  {
    id: "lr-1",
    type: "EXPORT",
    status: "COMPLETED",
    reason: "Customer requested a copy under DSR-2291",
    createdAt: new Date().toISOString(),
    hardDeleteDeadline: null,
  },
  {
    id: "lr-2",
    type: "DELETION",
    status: "REQUESTED",
    reason: "Customer is closing the account",
    createdAt: new Date().toISOString(),
    hardDeleteDeadline: new Date(Date.now() + 30 * 864e5).toISOString(),
  },
];

async function openData(
  page: Page,
  opts: { capabilities?: string[]; exportRefusal?: { reason: string; message: string } } = {}
): Promise<Sent[]> {
  const sent: Sent[] = [];
  await signInAsAdmin(page, { capabilities: opts.capabilities });

  await page.route(`${API}/lifecycle/`, (route) => route.fulfill(json({ requests })));
  await page.route(`${API}/lifecycle/exports`, (route) => {
    if (opts.exportRefusal) {
      const request = route.request();
      sent.push({
        method: request.method(),
        url: request.url(),
        body: (request.postDataJSON?.() as Record<string, unknown>) ?? null,
      });
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: {
            code: "FORBIDDEN",
            message: opts.exportRefusal.message,
            details: { reason: opts.exportRefusal.reason },
          },
        }),
      });
    }
    return record(sent, route, { request: { id: "lr-3" } });
  });
  await page.route(`${API}/lifecycle/deletions`, (route) =>
    record(sent, route, { id: "lr-4", status: "REQUESTED" })
  );

  await page.goto("/admin/data");
  await expect(page.getByRole("heading", { level: 1, name: "Data" })).toBeVisible();
  return sent;
}

const REASON = "Customer requested a copy under DSR-2291";

test.describe("admin data lifecycle", () => {
  test("lists the workspace's export and deletion requests", async ({ page }) => {
    await openData(page);
    // `.first()` rather than a bare visibility check: Row renders its title in
    // more than one layout, so the bare locator is a strict-mode violation
    // rather than a missing row.
    await expect(page.getByText("Data export").first()).toBeVisible();
    await expect(page.getByText("Deletion request").first()).toBeVisible();
    // The reason travels with the request — it is what a later reader has.
    await expect(page.getByText(/DSR-2291/).first()).toBeVisible();
  });

  test("will not send a request without a reason", async ({ page }) => {
    const sent = await openData(page);
    // The reason is what a later reader depends on to know why the workspace's
    // data left it, so the button stays shut until there is one.
    await expect(page.getByRole("button", { name: "Request export" })).toBeDisabled();
    expect(sent).toHaveLength(0);
  });

  test("requests an export through step-up, carrying the reason", async ({ page }) => {
    const sent = await openData(page);

    await page.getByLabel("Why, and who asked").fill(REASON);
    await page.getByRole("button", { name: "Request export" }).click();
    await page.waitForTimeout(600);

    const exported = sent.find((s) => s.url.includes("/lifecycle/exports"));
    expect(exported, "Request export must reach /lifecycle/exports").toBeTruthy();
    expect(exported!.body?.reason).toBe(REASON);
  });

  test("confirms before raising a deletion, and says it deletes nothing yet", async ({ page }) => {
    const sent = await openData(page);

    await page.getByLabel("Why, and who asked").fill("Customer is closing the account");
    await page.getByRole("button", { name: "Request deletion" }).click();

    const dialog = page.getByRole("dialog");
    // An Admin raising this must not believe they have deleted the workspace.
    await expect(dialog).toContainText(/does not delete anything/i);
    expect(sent.filter((s) => s.url.includes("/deletions"))).toHaveLength(0);

    await dialog.getByRole("button", { name: "Raise the request" }).click();
    await page.waitForTimeout(600);

    expect(sent.find((s) => s.url.includes("/lifecycle/deletions"))).toBeTruthy();
  });

  test("shows a policy refusal as one an Owner can fix", async ({ page }) => {
    await openData(page, {
      exportRefusal: {
        reason: "NO_ACTIVE_POLICY",
        message:
          "This workspace has not enabled exports for administrators. An Owner can do this, or activate a EXPORT policy.",
      },
    });

    await page.getByLabel("Why, and who asked").fill(REASON);
    await page.getByRole("button", { name: "Request export" }).click();

    await expect(page.getByText(/has not enabled exports for administrators/)).toBeVisible();
  });

  test("offers no approval control — deciding stays with the Owner", async ({ page }) => {
    await openData(page);
    // RBAC §2 marks Support "Workflow" and Admin "By policy" for raising one;
    // approving, scheduling and confirming are the Owner's alone, so this
    // screen must not offer them however permissive a policy becomes.
    await expect(page.getByRole("button", { name: /approve/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /schedule/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /confirm deletion/i })).toHaveCount(0);
  });

  test("disables export for an admin without data.export", async ({ page }) => {
    await openData(page, {
      capabilities: ADMIN_CAPABILITIES.filter((c) => c !== "data.export"),
    });
    await page.getByLabel("Why, and who asked").fill(REASON);
    await expect(page.getByRole("button", { name: "Request export" })).toBeDisabled();
  });
});
