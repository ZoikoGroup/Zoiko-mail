import { test, expect, type Page } from "@playwright/test";

/**
 * Saving workspace settings, and the saved values coming back.
 *
 * The Save button had no handler at all and the inputs were uncontrolled, so
 * typing changed nothing that could be sent and a refetch could not have
 * shown anything different. Both halves are asserted here: that a save sends
 * the edited field, and that the screen afterwards shows what the server
 * stored rather than what was typed.
 */

const API = "**/api/v1";

interface Tenant {
  id: string;
  name: string;
  /**
   * The real GET /tenants/current returns this, and the dashboard reads it on
   * the way through to the settings screen. Omitting it here made the stub
   * unfaithful in a way that only showed up once the dashboard rendered fast
   * enough to reach it.
   */
  status: string;
  planCode: string;
  timezone: string;
  allowedDomains: string[];
}

/**
 * Serves the tenant, and lets a PATCH change what is served next.
 *
 * The server normalises — it lowercases and de-duplicates domains — so the
 * stub does too. That is the behaviour that makes re-reading necessary rather
 * than optional.
 */
async function stubTenant(page: Page, initial: Tenant) {
  const state = { ...initial };
  const patches: Array<Record<string, unknown>> = [];

  await page.route(`${API}/tenants/current`, async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      patches.push(body);
      if (typeof body.name === "string") state.name = body.name.trim();
      if (typeof body.timezone === "string") state.timezone = body.timezone.trim();
      if (Array.isArray(body.allowedDomains)) {
        state.allowedDomains = (body.allowedDomains as string[]).map((d) =>
          d.trim().toLowerCase()
        );
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: state }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: state }),
    });
  });

  return { patches, state };
}

/** A signed-in admin session, plus benign answers for everything else. */
async function signInAsAdmin(page: Page) {
  const session = {
    accessToken: "stub-access-token",
    refreshToken: "stub-refresh-token",
    expiresIn: "12h",
    user: { id: "u1", email: "admin@zoiko.test", displayName: "Admin" },
    tenant: { id: "t1", name: "Acme Corp", planCode: "starter" },
    membership: { id: "m1", role: "ADMIN" },
    workspace: "ADMIN",
  };

  await page.route(`${API}/auth/me`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          ...session.user,
          tenant: session.tenant,
          membership: session.membership,
          workspace: "ADMIN",
        },
      }),
    })
  );
  await page.route(`${API}/auth/login`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { state: "SIGNED_IN", session, ...session },
      }),
    })
  );

  // Everything the shell reads, including the capability list — the Save
  // button only renders for workspace.settings.write.
  await page.route(`${API}/users/me/capabilities`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      // A flat list of capability keys, plus the decisions behind denials —
      // the shape useCan() builds its Set from. An array of objects reads as
      // "no capabilities", which hides the Save button and makes every
      // editable field read-only.
      body: JSON.stringify({
        success: true,
        data: {
          capabilities: [
            "workspace.settings.read",
            "workspace.settings.write",
          ],
          decisions: [],
        },
      }),
    })
  );
  // Registered last, so it is consulted first — anything with its own handler
  // has to be handed back explicitly. Missing the capability list here made it
  // answer with an empty page shape, which fetchCapabilities rejects, so the
  // Save button never rendered and every field stayed read-only.
  await page.route(`${API}/**`, (route) => {
    const url = route.request().url();
    if (
      url.includes("/auth/") ||
      url.includes("/tenants/current") ||
      url.includes("/users/me/capabilities")
    ) {
      return route.fallback();
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { items: [], count: 0 } }),
    });
  });

  await page.goto("/login");
  await page.getByPlaceholder("john@example.com").fill("admin@zoiko.test");
  await page.getByPlaceholder("Enter your password").fill("Password123!");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 60_000 });
}

test.describe("workspace settings save", () => {
  const initial: Tenant = {
    id: "t1",
    name: "Acme Corp",
    status: "ACTIVE",
    planCode: "starter",
    timezone: "Europe/London",
    allowedDomains: ["acme.test"],
  };

  test("saves an edited field and shows what the server stored", async ({ page }) => {
    const stub = await stubTenant(page, initial);
    await signInAsAdmin(page);

    await page.goto("/admin/settings");
    const timezone = page.locator("#setting-timezone");
    await expect(timezone).toHaveValue("Europe/London", { timeout: 60_000 });

    // Nothing edited yet, so there is nothing to save and the button says so.
    const saveButton = page.getByRole("button", { name: /save changes/i });
    await expect(saveButton).toBeDisabled();

    await timezone.fill("Asia/Kolkata");
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    await expect(page.getByText(/^Saved\./)).toBeVisible({ timeout: 30_000 });
    // The request carried only the field that changed.
    expect(stub.patches).toHaveLength(1);
    expect(stub.patches[0]).toEqual({ timezone: "Asia/Kolkata" });
    await expect(timezone).toHaveValue("Asia/Kolkata");
  });

  test("shows the normalised value, not the typed one", async ({ page }) => {
    const stub = await stubTenant(page, initial);
    await signInAsAdmin(page);

    await page.goto("/admin/settings");
    const domain = page.locator("#setting-defaultDomain");
    await expect(domain).toHaveValue("acme.test", { timeout: 60_000 });

    // The server lowercases domains, so what it stores differs from what was
    // typed. This is the case that makes re-reading after a save necessary.
    await domain.fill("ACME.COM");
    await page.getByRole("button", { name: /save changes/i }).click();

    await expect(page.getByText(/^Saved\./)).toBeVisible({ timeout: 30_000 });
    // Sent as allowedDomains, not defaultDomain: the tenant has no single
    // default-domain column, so the screen's field maps onto the list.
    expect(stub.patches[0]).toEqual({ allowedDomains: ["ACME.COM"] });
    await expect(domain).toHaveValue("acme.com");
  });

  test("discards an edit without sending anything", async ({ page }) => {
    const stub = await stubTenant(page, initial);
    await signInAsAdmin(page);

    await page.goto("/admin/settings");
    const name = page.locator("#setting-name");
    await expect(name).toHaveValue("Acme Corp", { timeout: 60_000 });

    await name.fill("Something Else");
    await page.getByRole("button", { name: /discard/i }).click();

    await expect(name).toHaveValue("Acme Corp");
    expect(stub.patches).toHaveLength(0);
  });

  test("leaves the read-only plan alone", async ({ page }) => {
    await stubTenant(page, initial);
    await signInAsAdmin(page);

    await page.goto("/admin/settings");
    const plan = page.locator("#setting-plan");
    await expect(plan).toHaveValue("starter", { timeout: 60_000 });
    // Editable-looking but not editable: the plan is not this screen's to set.
    await expect(plan).toHaveAttribute("readonly", "");
  });
});

test.describe("workspace settings refuses a change it cannot save", () => {
  /**
   * The screen as it behaved when a required field was emptied.
   *
   * `name` is `min(1)` on the API, so an emptied name could only ever come
   * back a 400. It did — worded "Validation failed" under the heading
   * "Could not load this", because InlineError hardcoded that heading for
   * saves as well as reads. The report named neither the field nor the rule
   * and blamed loading, so the reasonable conclusion was that the page could
   * not save at all.
   *
   * Three things are pinned here: the doomed request is not sent, the field
   * that is wrong is the one carrying the message, and a save failure is
   * described as a save failure.
   */
  const initial: Tenant = {
    id: "t1",
    name: "Acme Corp",
    status: "ACTIVE",
    planCode: "starter",
    timezone: "Europe/London",
    allowedDomains: ["acme.test"],
  };

  test("an emptied workspace name blocks the save and says which field is wrong", async ({
    page,
  }) => {
    const stub = await stubTenant(page, initial);
    await signInAsAdmin(page);

    await page.goto("/admin/settings");
    const name = page.locator("#setting-name");
    await expect(name).toHaveValue("Acme Corp", { timeout: 60_000 });

    await name.fill("");

    // Named next to the field, while the person is still looking at it.
    await expect(page.getByText("A workspace name is required.")).toBeVisible();
    await expect(name).toHaveAttribute("aria-invalid", "true");

    // Dirty, but not submittable: a request that can only 400 is not worth
    // making, and an enabled button promises it would work.
    await expect(page.getByRole("button", { name: /save changes/i })).toBeDisabled();
    expect(stub.patches).toHaveLength(0);

    // Typing a name again clears the objection and restores the button.
    await name.fill("Acme Limited");
    await expect(page.getByText("A workspace name is required.")).toBeHidden();
    await expect(page.getByRole("button", { name: /save changes/i })).toBeEnabled();
  });

  test("a field the server rejects is reported on that field, as a save failure", async ({
    page,
  }) => {
    await stubTenant(page, initial);
    await signInAsAdmin(page);

    // The server is the authority on the rest — a domain it will not accept
    // comes back per-field, and the screen has to place it.
    await page.route(`${API}/tenants/current`, async (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Validation failed",
            details: [{ path: "allowedDomains.0", message: "Enter a valid domain name" }],
          },
        }),
      });
    });

    await page.goto("/admin/settings");
    const domain = page.locator("#setting-defaultDomain");
    await expect(domain).toHaveValue("acme.test", { timeout: 60_000 });

    await domain.fill("not a domain");
    await page.getByRole("button", { name: /save changes/i }).click();

    // The server says allowedDomains; the screen calls it Default domain. The
    // message has to land on the control the person can actually see, which is
    // the element the field's input points at with aria-describedby.
    await expect(page.locator("#setting-defaultDomain-error")).toHaveText(
      "Enter a valid domain name",
      { timeout: 30_000 }
    );
    await expect(domain).toHaveAttribute("aria-invalid", "true");

    // And the banner repeats the reason without the column name behind it.
    await expect(page.getByText("allowedDomains")).toBeHidden();

    // The failure is described as what it was. "Could not load this" sent the
    // reader looking for a broken page instead of a bad value.
    await expect(page.getByText("Could not save your changes")).toBeVisible();
    await expect(page.getByText("Could not load this")).toBeHidden();
  });
});
