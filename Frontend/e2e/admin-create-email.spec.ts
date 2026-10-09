import { test, expect, type Page, type Route } from "@playwright/test";
import { API, ADMIN_CAPABILITIES, json, signInAsAdmin } from "./admin-harness";

/**
 * Create Email — the shared form → review → result flow on the Admin
 * Mailboxes screen (the Owner screen renders the same component).
 *
 * Every API call is stubbed. What these tests protect is what the screen
 * sends and what it claims: the request carries business data only, nothing
 * is created before Confirm, and the result never says a mailbox exists
 * unless the server said the mail server confirmed it.
 */

const GIB = 1024 ** 3;

const options = (over: Record<string, unknown> = {}) => ({
  providerConfigured: true,
  provider: "STALWART",
  domains: [
    {
      id: "dom-acme", domainName: "acme.test", verificationStatus: "VERIFIED", usable: true,
      readiness: { ownershipVerified: true, inboundRouting: true, outboundConfigured: false, dmarcPublished: false },
    },
    {
      id: "dom-new", domainName: "pending.test", verificationStatus: "PENDING", usable: false,
      readiness: { ownershipVerified: false, inboundRouting: false, outboundConfigured: false, dmarcPublished: false },
    },
  ],
  quota: { optionsBytes: [1, 5, 10, 25].map((g) => g * GIB), defaultBytes: 10 * GIB, maxBytes: 25 * GIB },
  mailboxes: { used: 2, limit: 10 },
  invitationDelivery: "EMAIL",
  ...over,
});

const result = (over: Record<string, unknown> = {}) => ({
  id: "mb-john",
  address: "john@acme.test",
  displayName: "Support Team",
  domainName: "acme.test",
  quotaBytes: 5 * GIB,
  appliedQuotaBytes: 5 * GIB,
  provisioningStatus: "PROVISIONED",
  provisioningError: null,
  invitationStatus: "SENT",
  invitationError: null,
  invitationRecipient: "john.personal@elsewhere.test",
  membershipStatus: "INVITED",
  status: "INVITATION_PENDING",
  ...over,
});

interface Captured {
  provision: Array<{ body: unknown; idempotencyKey: string | undefined }>;
  retry: number;
  resend: number;
}

async function open(
  page: Page,
  opts: {
    capabilities?: string[];
    options?: Record<string, unknown>;
    provision?: (route: Route) => Promise<void> | void;
    retry?: Record<string, unknown>;
    resend?: Record<string, unknown>;
    mailboxes?: unknown[];
  } = {}
): Promise<Captured> {
  const captured: Captured = { provision: [], retry: 0, resend: 0 };
  await signInAsAdmin(page, { capabilities: opts.capabilities });

  await page.route(`${API}/mail/admin/mailboxes`, (route) => route.fulfill(json(opts.mailboxes ?? [])));
  await page.route(`${API}/mail/admin/mailboxes/provisioning-options`, (route) =>
    route.fulfill(json(options(opts.options)))
  );
  await page.route(`${API}/mail/admin/mailboxes/provision`, async (route) => {
    captured.provision.push({
      body: route.request().postDataJSON(),
      idempotencyKey: route.request().headers()["idempotency-key"],
    });
    if (opts.provision) return opts.provision(route);
    return route.fulfill({ ...json(result()), status: 201 });
  });
  await page.route(`${API}/mail/admin/mailboxes/*/provisioning/retry`, (route) => {
    captured.retry += 1;
    return route.fulfill(json(result(opts.retry)));
  });
  await page.route(`${API}/mail/admin/mailboxes/*/invitation/resend`, (route) => {
    captured.resend += 1;
    return route.fulfill(json(result(opts.resend)));
  });

  await page.goto("/admin/mailboxes");
  await expect(page.getByRole("heading", { level: 1, name: "Mailboxes" })).toBeVisible();
  return captured;
}

async function fillForm(page: Page) {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Domain").selectOption("dom-acme");
  await dialog.getByLabel("Username").fill("John");
  await dialog.getByLabel("Display name").fill("Support Team");
  await dialog.getByLabel("Mailbox quota").selectOption(String(5 * GIB));
  await dialog.getByLabel("Send invitation to").fill("john.personal@elsewhere.test");
  return dialog;
}

test.describe("Create Email", () => {
  test("goes from details to review to result, sending business data only", async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const captured = await open(page, {
      provision: async (route) => {
        await gate;
        await route.fulfill({ ...json(result()), status: 201 });
      },
    });

    await page.getByRole("button", { name: "+ Create Email" }).click();
    const dialog = await fillForm(page);

    // The address is derived as they type, lower-cased.
    await expect(dialog.getByTestId("ce-address-preview")).toHaveText("john@acme.test");
    // An unverified domain is named but cannot be picked.
    await expect(dialog.getByRole("option", { name: "pending.test (not verified)" })).toBeDisabled();

    await dialog.getByRole("button", { name: "Review" }).click();
    await expect(dialog.getByTestId("review-address")).toHaveText("john@acme.test");
    await expect(dialog).toContainText("Support Team");
    await expect(dialog).toContainText("5 GB");
    await expect(dialog).toContainText("Secure invitation");
    await expect(dialog).toContainText("john.personal@elsewhere.test");
    await expect(dialog).toContainText("Sending is not ready yet");
    expect(captured.provision).toHaveLength(0);

    // Back keeps what was typed.
    await dialog.getByRole("button", { name: "Back to edit" }).click();
    await expect(dialog.getByLabel("Username")).toHaveValue("John");
    await dialog.getByRole("button", { name: "Review" }).click();

    await dialog.getByRole("button", { name: "Confirm & create" }).click();
    await expect(dialog.getByRole("button", { name: "Creating…" })).toBeDisabled();
    // Nothing claims success while the server has not answered.
    await expect(dialog).not.toContainText("Mailbox created on the mail server");
    release();

    await expect(dialog).toContainText("Mailbox created on the mail server with a 5 GB quota");
    await expect(dialog.getByTestId("invitation-status")).toHaveText(
      "Invitation sent to john.personal@elsewhere.test."
    );
    await expect(dialog).toContainText("Invitation Pending");

    expect(captured.provision).toHaveLength(1);
    expect(captured.provision[0]!.body).toEqual({
      domainId: "dom-acme",
      localPart: "john",
      displayName: "Support Team",
      quotaBytes: 5 * GIB,
      initialAccess: "INVITE",
      recoveryEmail: "john.personal@elsewhere.test",
    });
    expect(captured.provision[0]!.idempotencyKey).toBeTruthy();
  });

  test("validates before review and sends nothing", async ({ page }) => {
    // Two verified domains, so none is pre-selected and the domain check runs.
    const base = options();
    const captured = await open(page, {
      options: {
        domains: [
          ...base.domains,
          { ...base.domains[0], id: "dom-other", domainName: "other.test" },
        ],
      },
    });
    await page.getByRole("button", { name: "+ Create Email" }).click();
    const dialog = page.getByRole("dialog");

    await dialog.getByRole("button", { name: "Review" }).click();
    await expect(dialog).toContainText("Choose a verified domain.");
    await expect(dialog).toContainText("Enter the part before the @.");
    await expect(dialog).toContainText("Enter the name shown beside the address.");
    await expect(dialog).toContainText("Enter the address the invitation should go to.");

    await dialog.getByLabel("Username").fill("postmaster");
    await expect(dialog).toContainText("postmaster@ is reserved");
    await dialog.getByLabel("Username").fill("john..smith");
    await expect(dialog).toContainText("Use letters, numbers, dots");
    await dialog.getByLabel("Send invitation to").fill("not-an-email");
    await expect(dialog).toContainText("Enter a valid email address.");

    // Still on the details step.
    await expect(dialog.getByRole("button", { name: "Confirm & create" })).toHaveCount(0);
    expect(captured.provision).toHaveLength(0);
  });

  test("shows a provisioning failure and finishes it with Retry", async ({ page }) => {
    const captured = await open(page, {
      provision: (route) =>
        route.fulfill({
          ...json(result({ provisioningStatus: "FAILED", provisioningError: "STALWART_TIMEOUT", invitationStatus: "PENDING", status: "FAILED" })),
          status: 202,
        }),
    });
    await page.getByRole("button", { name: "+ Create Email" }).click();
    const dialog = await fillForm(page);
    await dialog.getByRole("button", { name: "Review" }).click();
    await dialog.getByRole("button", { name: "Confirm & create" }).click();

    await expect(dialog).toContainText("Provisioning failed.");
    await expect(dialog).toContainText("will not create a second one");
    await expect(dialog).not.toContainText("Mailbox created on the mail server");

    await dialog.getByRole("button", { name: "Retry provisioning" }).click();
    await expect(dialog).toContainText("Mailbox created on the mail server");
    expect(captured.retry).toBe(1);
    expect(captured.provision).toHaveLength(1);
  });

  test("keeps invitation status apart, and resends without creating again", async ({ page }) => {
    const captured = await open(page, {
      provision: (route) =>
        route.fulfill({ ...json(result({ invitationStatus: "FAILED", invitationError: "DELIVERY_FAILED" })), status: 201 }),
    });
    await page.getByRole("button", { name: "+ Create Email" }).click();
    const dialog = await fillForm(page);
    await dialog.getByRole("button", { name: "Review" }).click();
    await dialog.getByRole("button", { name: "Confirm & create" }).click();

    await expect(dialog).toContainText("Mailbox created on the mail server");
    await expect(dialog.getByTestId("invitation-status")).toContainText("could not be delivered");

    await dialog.getByRole("button", { name: "Send invitation" }).click();
    await expect(dialog.getByTestId("invitation-status")).toHaveText(
      "Invitation sent to john.personal@elsewhere.test."
    );
    expect(captured.resend).toBe(1);
    expect(captured.provision).toHaveLength(1);
  });

  test("stays on review when the server refuses, and says nothing was created", async ({ page }) => {
    await open(page, {
      provision: (route) =>
        route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            success: false,
            error: { code: "CONFLICT", message: "john@acme.test is already in use", details: { reason: "ADDRESS_TAKEN" } },
          }),
        }),
    });
    await page.getByRole("button", { name: "+ Create Email" }).click();
    const dialog = await fillForm(page);
    await dialog.getByRole("button", { name: "Review" }).click();
    await dialog.getByRole("button", { name: "Confirm & create" }).click();

    await expect(dialog).toContainText("Not created.");
    await expect(dialog).toContainText("john@acme.test is already in use");
    await expect(dialog.getByRole("button", { name: "Back to edit" })).toBeEnabled();
  });

  test("blocks creation when mailbox hosting is not configured", async ({ page }) => {
    await open(page, { options: { providerConfigured: false } });
    await page.getByRole("button", { name: "+ Create Email" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Mailbox hosting is not configured");
    await expect(dialog.getByRole("button", { name: "Review" })).toBeDisabled();
  });

  test("is not offered without both server capabilities", async ({ page }) => {
    await open(page, { capabilities: ADMIN_CAPABILITIES.filter((c) => c !== "people.invite.member") });
    await expect(page.getByRole("button", { name: "+ Create Email" })).toHaveCount(0);
  });

  test("lists provisioning and invitation statuses with their next action", async ({ page }) => {
    const row = (over: Record<string, unknown>) => ({
      membershipId: "m1", type: "USER", storageUsed: 0, storageLimit: 5 * GIB,
      sendSuspendedAt: null, sendSuspensionReason: null, aiEnabled: true, displayName: null,
      provisioningError: null, invitationError: null,
      ...over,
    });
    const captured = await open(page, {
      mailboxes: [
        row({ id: "mb-failed", address: "failed@acme.test", provisioningStatus: "FAILED", provisioningError: "STALWART_UNAVAILABLE", invitationStatus: "PENDING", membership: { status: "INVITED", user: { email: "f@x.test" } } }),
        row({ id: "mb-invited", address: "invited@acme.test", provisioningStatus: "PROVISIONED", invitationStatus: "SENT", membership: { status: "INVITED", user: { email: "i@x.test" } } }),
        row({ id: "mb-active", address: "active@acme.test", provisioningStatus: null, invitationStatus: null, membership: { status: "ACTIVE", user: { email: "a@x.test" } } }),
      ],
    });

    const table = page.getByRole("table");
    await expect(table.getByRole("row", { name: /failed@acme\.test/ })).toContainText("Failed");
    await expect(table.getByRole("row", { name: /invited@acme\.test/ })).toContainText("Invitation Pending");
    await expect(table.getByRole("row", { name: /active@acme\.test/ })).toContainText("Active");

    await page.getByRole("button", { name: "Retry provisioning for failed@acme.test" }).click();
    await expect.poll(() => captured.retry).toBe(1);

    // Filter by status.
    await page.getByLabel("Filter by status").selectOption("FAILED");
    await expect(table.getByRole("row", { name: /invited@acme\.test/ })).toHaveCount(0);
  });

  test("fits a phone-width screen without horizontal scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await open(page);
    await page.getByRole("button", { name: "+ Create Email" }).click();
    await fillForm(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
