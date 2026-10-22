import { test, expect, type Page, type Route } from "@playwright/test";
import { API, ADMIN_CAPABILITIES, json, signInAsAdmin } from "./admin-harness";

/**
 * Create Email — the shared form → review → result flow on the Admin
 * Mailboxes screen (the Owner screen renders the same component).
 *
 * Every API call is stubbed. What these tests protect is what the screen
 * sends and what it claims: the request carries business data only (no
 * second, invitation address), nothing is created before Confirm, the result
 * never says a mailbox exists unless the server said so, and the setup link
 * is shown to copy but never put in the address bar.
 */

const GIB = 1024 ** 3;
const LINK = "https://app.test/invitation/accept?token=first-token-123";
const FRESH = "https://app.test/invitation/accept?token=second-token-456";

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
  invitationDelivery: "LINK",
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
  invitationStatus: "PENDING",
  invitationError: null,
  invitationRecipient: "john@acme.test",
  membershipStatus: "INVITED",
  passwordSetup: "PENDING",
  status: "INVITATION_PENDING",
  invitationLink: LINK,
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
    await expect(dialog).toContainText("Sending is not ready yet");
    // No separate invitation address any more: they sign in as the new address.
    await expect(dialog.getByLabel("Send invitation to")).toHaveCount(0);
    await expect(dialog).toContainText("you get a setup link to copy and share. No email is sent.");
    expect(captured.provision).toHaveLength(0);

    // Back keeps what was typed.
    await dialog.getByRole("button", { name: "Back to edit" }).click();
    await expect(dialog.getByLabel("Username")).toHaveValue("John");
    await dialog.getByRole("button", { name: "Review" }).click();

    await dialog.getByRole("button", { name: "Confirm & create" }).click();
    await expect(dialog.getByRole("button", { name: "Creating…" })).toBeDisabled();
    // Nothing claims success while the server has not answered.
    await expect(dialog).not.toContainText("Email account created");
    release();

    await expect(dialog.getByTestId("create-result-heading")).toHaveText("Email account created");
    await expect(dialog).toContainText("Created on the mail server with a 5 GB quota");
    await expect(dialog.getByTestId("result-address")).toHaveText("john@acme.test");
    await expect(dialog.getByTestId("result-status")).toHaveText("Setup Pending");
    await expect(dialog.getByTestId("result-password-setup")).toHaveText("Pending");
    await expect(dialog.getByTestId("invitation-link-box").getByLabel("Invitation link")).toHaveValue(LINK);

    expect(captured.provision).toHaveLength(1);
    expect(captured.provision[0]!.body).toEqual({
      domainId: "dom-acme",
      localPart: "john",
      displayName: "Support Team",
      quotaBytes: 5 * GIB,
      initialAccess: "INVITE",
      // The Workspace Access choice; Member only unless the admin ticks more.
      workspaces: ["MEMBER"],
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

    await dialog.getByLabel("Username").fill("postmaster");
    await expect(dialog).toContainText("postmaster@ is reserved");
    await dialog.getByLabel("Username").fill("john..smith");
    await expect(dialog).toContainText("Use letters, numbers, dots");

    // Still on the details step.
    await expect(dialog.getByRole("button", { name: "Confirm & create" })).toHaveCount(0);
    expect(captured.provision).toHaveLength(0);
  });

  test("shows a provisioning failure and finishes it with Retry", async ({ page }) => {
    const captured = await open(page, {
      provision: (route) =>
        route.fulfill({
          ...json(result({ provisioningStatus: "FAILED", provisioningError: "STALWART_TIMEOUT", invitationStatus: "PENDING", status: "FAILED", invitationLink: null })),
          status: 202,
        }),
    });
    await page.getByRole("button", { name: "+ Create Email" }).click();
    const dialog = await fillForm(page);
    await dialog.getByRole("button", { name: "Review" }).click();
    await dialog.getByRole("button", { name: "Confirm & create" }).click();

    await expect(dialog).toContainText("Provisioning failed.");
    await expect(dialog).toContainText("will not create a second one");
    await expect(dialog.getByTestId("result-status")).toHaveText("Failed");
    await expect(dialog).not.toContainText("Email account created");
    // No setup link until there is a mailbox to set up.
    await expect(dialog.getByTestId("invitation-link-box")).toHaveCount(0);

    await dialog.getByRole("button", { name: "Retry provisioning" }).click();
    await expect(dialog.getByTestId("create-result-heading")).toHaveText("Email account created");
    await expect(dialog.getByTestId("invitation-link-box").getByLabel("Invitation link")).toHaveValue(LINK);
    expect(captured.retry).toBe(1);
    expect(captured.provision).toHaveLength(1);
  });

  for (const delivery of ["LINK", "DISABLED", "EMAIL"]) {
    test(`gives a setup link to copy whatever email is set to (${delivery}) — for a mailbox Zoiko stores`, async ({ page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const captured = await open(page, {
        options: { hostingMode: "ZOIKO_STORE", invitationDelivery: delivery },
        provision: (route) => route.fulfill({ ...json(result({ provisioningStatus: null })), status: 201 }),
        resend: { provisioningStatus: null, invitationLink: FRESH },
      });
      await page.getByRole("button", { name: "+ Create Email" }).click();
      const dialog = await fillForm(page);
      await dialog.getByRole("button", { name: "Review" }).click();
      await dialog.getByRole("button", { name: "Confirm & create" }).click();

      // A mailbox with no mail-server half is complete as created: it does not
      // claim to be provisioning, and offers no Retry.
      await expect(dialog.getByTestId("create-result-heading")).toHaveText("Email account created");
      await expect(dialog).toContainText("Mail for this address is stored by Zoiko Mail");
      await expect(dialog.getByRole("button", { name: "Retry provisioning" })).toHaveCount(0);

      // The link is on screen, read-only, to copy.
      const box = dialog.getByTestId("invitation-link-box");
      const field = box.getByLabel("Invitation link");
      await expect(field).toHaveValue(LINK);
      await expect(field).toHaveAttribute("readonly", "");
      await box.getByRole("button", { name: "Copy Invitation Link" }).click();
      await expect(box).toContainText("Link copied to clipboard.");
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(LINK);

      // It never reaches the address bar or browser storage.
      expect(page.url()).not.toContain("token=");
      const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
      expect(stored).not.toContain("first-token-123");

      // A new link replaces it, and the old one is no longer shown.
      await dialog.getByRole("button", { name: "Generate New Link" }).click();
      await expect(field).toHaveValue(FRESH);
      await expect(dialog).not.toContainText("first-token-123");
      expect(captured.resend).toBe(1);
      expect(captured.provision).toHaveLength(1);
    });
  }

  test("says so when the link cannot be copied automatically", async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error("denied")) },
      });
    });
    await page.getByRole("button", { name: "+ Create Email" }).click();
    const dialog = await fillForm(page);
    await dialog.getByRole("button", { name: "Review" }).click();
    await dialog.getByRole("button", { name: "Confirm & create" }).click();

    const box = dialog.getByTestId("invitation-link-box");
    await box.getByRole("button", { name: "Copy Invitation Link" }).click();
    await expect(box).toContainText("Could not copy automatically");
    await expect(box).not.toContainText("Link copied");
  });

  test("offers a new link when the first one is no longer on screen", async ({ page }) => {
    // A replayed create (a retried request) carries no link: it is shown once.
    const captured = await open(page, {
      provision: (route) => route.fulfill({ ...json(result({ invitationLink: undefined })), status: 201 }),
      resend: { invitationLink: FRESH },
    });
    await page.getByRole("button", { name: "+ Create Email" }).click();
    const dialog = await fillForm(page);
    await dialog.getByRole("button", { name: "Review" }).click();
    await dialog.getByRole("button", { name: "Confirm & create" }).click();

    await expect(dialog.getByTestId("invitation-status")).toContainText("shown only once");
    await dialog.getByRole("button", { name: "Generate New Link" }).click();
    await expect(dialog.getByTestId("invitation-link-box").getByLabel("Invitation link")).toHaveValue(FRESH);
    expect(captured.resend).toBe(1);
  });

  test("shows no link, and setup complete, for somebody who already signs in with that address", async ({ page }) => {
    await open(page, {
      provision: (route) =>
        route.fulfill({
          ...json(result({ invitationStatus: "NOT_REQUIRED", membershipStatus: "ACTIVE", passwordSetup: "COMPLETED", status: "ACTIVE", invitationLink: null })),
          status: 201,
        }),
    });
    await page.getByRole("button", { name: "+ Create Email" }).click();
    const dialog = await fillForm(page);
    await dialog.getByRole("button", { name: "Review" }).click();
    await dialog.getByRole("button", { name: "Confirm & create" }).click();

    await expect(dialog.getByTestId("result-status")).toHaveText("Ready");
    await expect(dialog.getByTestId("result-password-setup")).toHaveText("Completed");
    await expect(dialog.getByTestId("invitation-link-box")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Generate New Link" })).toHaveCount(0);
  });

  test("Go to Mailboxes closes the result and drops the link", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "+ Create Email" }).click();
    const dialog = await fillForm(page);
    await dialog.getByRole("button", { name: "Review" }).click();
    await dialog.getByRole("button", { name: "Confirm & create" }).click();
    await expect(dialog.getByTestId("invitation-link-box")).toBeVisible();

    await dialog.getByRole("button", { name: "Go to Mailboxes" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("first-token-123")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Mailboxes" })).toBeVisible();
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
    await expect(table.getByRole("row", { name: /invited@acme\.test/ })).toContainText("Setup Pending");
    await expect(table.getByRole("row", { name: /active@acme\.test/ })).toContainText("Ready");
    await expect(page.getByRole("button", { name: "Generate new setup link for invited@acme.test" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate new setup link for active@acme.test" })).toHaveCount(0);

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
