import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { API, signIn, useRealWorkspace } from "./real-harness";

/**
 * Contacts & People Directory, against the real API and database.
 *
 * Two Members of a throwaway workspace. Everything a person does on the page
 * is checked to have reached the server (by reloading, or by reading it back
 * through the API), and the privacy line is checked from the other side: a
 * colleague sees a shared contact, never a personal one, and cannot change it.
 */

const getFixture = useRealWorkspace();
test.describe.configure({ mode: "serial" });

const key = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function token(request: APIRequestContext, email: string) {
  const res = await request.post(`${API}/auth/login`, { data: { email, password: getFixture().password, workspace: "MEMBER" } });
  return (await res.json()).data.accessToken as string;
}

async function api(request: APIRequestContext, t: string) {
  const headers = () => ({ Authorization: `Bearer ${t}`, "Idempotency-Key": key("ct") });
  return {
    post: (path: string, data: object) => request.post(`${API}${path}`, { headers: headers(), data }),
    get: (path: string) => request.get(`${API}${path}`, { headers: { Authorization: `Bearer ${t}` } }),
  };
}

async function openContacts(page: Page, query = "") {
  await page.goto(`/mail/contacts${query}`);
  await expect(page.getByRole("heading", { name: "Contacts & People Directory" })).toBeVisible({ timeout: 90_000 });
}

const list = (page: Page) => page.getByTestId("contacts-list");
const details = (page: Page) => page.getByTestId("contact-details");

test("the page lists colleagues, creates a contact with validation, and keeps it after a reload", async ({ browser }) => {
  const f = getFixture();
  const { page, context } = await signIn(browser, f.sender.address, f.password);
  await page.setViewportSize({ width: 1600, height: 950 });

  // From the rail, not a typed URL: Contacts is a real section now.
  await page.getByRole("navigation", { name: "Workspace sections" }).first().getByRole("link", { name: "Contacts", exact: true }).click();
  await expect(page).toHaveURL(/\/mail\/contacts$/, { timeout: 60_000 });
  await expect(page.getByTestId("coming-soon")).toHaveCount(0);

  // The other Member is in the directory, and counted as available.
  await expect(list(page).getByText(f.recipient.address)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("contacts-available")).toHaveText("1");
  await expect(details(page)).toContainText("Workspace member");

  // A bad address is refused before anything is sent.
  await page.getByRole("button", { name: "New Contact" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New contact" });
  await dialog.getByLabel("First name").fill("Sarah");
  await dialog.getByLabel("Last name").fill("Chen");
  await dialog.getByLabel("Email").fill("sarah.chen@");
  await dialog.getByLabel("Phone").fill("call me");
  await dialog.getByRole("button", { name: "Add contact" }).click();
  await expect(dialog.getByText("Enter a valid email address.")).toBeVisible();
  await expect(dialog.getByText("Enter a valid phone number.")).toBeVisible();

  await dialog.getByLabel("Email").fill("sarah.chen@example.com");
  await dialog.getByLabel("Phone").fill("+44 20 7946 0000");
  await dialog.getByLabel("Company").fill("Example Corporation");
  await dialog.getByLabel("Job title").fill("Product Director");
  await dialog.getByLabel("Groups", { exact: true }).fill("Colleagues");
  await dialog.getByLabel("Groups", { exact: true }).press("Enter");
  await dialog.getByRole("button", { name: "Add contact" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("contacts-notice")).toContainText("Sarah added to your contacts");

  await expect(details(page).getByTestId("contact-details-name")).toHaveText("Sarah Chen");
  await expect(details(page)).toContainText("Product Director · Example Corporation");
  await expect(details(page)).toContainText("+44 20 7946 0000");
  await expect(details(page)).toContainText("Colleagues");
  await expect(details(page)).toContainText("Personal address book");

  // A second contact with the same address is refused by the server, with its reason.
  await page.getByRole("button", { name: "New Contact" }).first().click();
  await page.getByRole("dialog", { name: "New contact" }).getByLabel("Email").fill("SARAH.CHEN@example.com");
  await page.getByRole("dialog", { name: "New contact" }).getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByRole("dialog", { name: "New contact" }).getByRole("alert")).toContainText("already exists");
  await page.getByRole("dialog", { name: "New contact" }).getByRole("button", { name: "Cancel" }).click();

  await page.reload();
  await expect(list(page).getByText("sarah.chen@example.com")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("contacts-available")).toHaveText("2");
  await expect(page.getByRole("link", { name: /Contact Groups\s*1/ })).toBeVisible();
  await context.close();
});

test("search, sort, edit, favourite, groups and the tabs", async ({ browser, request }) => {
  const f = getFixture();
  const me = await api(request, await token(request, f.sender.address));
  await me.post("/contacts", { firstName: "Daniel", lastName: "Brooks", email: "daniel.brooks@example.org", company: "Northstar Studio", jobTitle: "Account Manager" });
  await me.post("/contacts", { firstName: "Amy", email: "amy@bridgepoint.example", company: "Bridgepoint Partners" });

  const { page, context } = await signIn(browser, f.sender.address, f.password);
  await page.setViewportSize({ width: 1600, height: 950 });
  await openContacts(page);

  const names = () => list(page).getByTestId("contact-row").allInnerTexts();
  await expect.poll(async () => (await names()).length, { timeout: 60_000 }).toBe(4);

  await page.getByPlaceholder("Search name, email or company…").fill("northstar");
  await expect.poll(async () => (await names()).length).toBe(1);
  await expect(list(page)).toContainText("Daniel Brooks");
  await page.getByPlaceholder("Search name, email or company…").fill("nobody-matches");
  await expect(page.getByTestId("contacts-empty")).toContainText("No one matches");
  await page.getByPlaceholder("Search name, email or company…").fill("");

  await page.getByLabel("Sort by").selectOption("company");
  await expect.poll(async () => (await names())[0]).toContain("Amy");

  // My Contacts leaves the colleague out.
  await page.getByRole("link", { name: "My Contacts" }).click();
  await expect.poll(async () => (await names()).length, { timeout: 60_000 }).toBe(3);
  await page.getByRole("link", { name: "Company Directory" }).click();
  await expect.poll(async () => (await names()).length, { timeout: 60_000 }).toBe(1);
  await page.getByRole("link", { name: "All Contacts" }).first().click();

  // Edit, then favourite from More.
  await list(page).getByText("Daniel Brooks").click();
  await details(page).getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit contact" });
  await dialog.getByLabel("Job title").fill("Head of Accounts");
  await dialog.getByLabel("Groups", { exact: true }).fill("Clients");
  await dialog.getByLabel("Groups", { exact: true }).press("Enter");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(details(page)).toContainText("Head of Accounts · Northstar Studio");

  await details(page).getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Add to Favourites" }).click();
  await expect(page.getByTestId("contacts-notice")).toContainText("Added to Favourites");

  await page.getByRole("link", { name: /^Favourites/ }).click();
  await expect.poll(async () => names(), { timeout: 60_000 }).toEqual([expect.stringContaining("Daniel Brooks")]);

  // The group lists its member.
  await page.getByRole("link", { name: /^Contact Groups/ }).click();
  await page.getByTestId("group-picker").getByRole("link", { name: /Clients/ }).click();
  await expect.poll(async () => names(), { timeout: 60_000 }).toEqual([expect.stringContaining("Daniel Brooks")]);

  // All of it is on the server.
  const saved = (await (await me.get("/contacts?scope=favorites")).json()).data.items;
  expect(saved).toEqual([expect.objectContaining({ email: "daniel.brooks@example.org", jobTitle: "Head of Accounts", tags: ["Clients"], isFavorite: true })]);
  await context.close();
});

test("a shared contact reaches the colleague read-only; a personal one never does", async ({ browser, request }) => {
  const f = getFixture();
  const { page, context } = await signIn(browser, f.sender.address, f.password);
  await page.setViewportSize({ width: 1600, height: 950 });
  await openContacts(page);
  await list(page).getByText("Sarah Chen").click();
  await details(page).getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Share with workspace" }).click();
  await expect(page.getByTestId("contacts-notice")).toContainText("Shared with your workspace");
  await expect(list(page).getByTestId("contact-row").filter({ hasText: "Sarah Chen" })).toContainText("Shared");
  await context.close();

  const other = await signIn(browser, f.recipient.address, f.password);
  await other.page.setViewportSize({ width: 1600, height: 950 });
  await openContacts(other.page, "?view=shared");
  await expect(list(other.page).getByText("Sarah Chen")).toBeVisible({ timeout: 60_000 });
  await list(other.page).getByText("Sarah Chen").click();
  await expect(details(other.page)).toContainText("Shared by E2E");
  await expect(details(other.page).getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(details(other.page).getByRole("button", { name: "More" })).toHaveCount(0);
  // Daniel and Amy are the sender's personal contacts.
  await openContacts(other.page);
  await expect(list(other.page).getByText("Sarah Chen")).toBeVisible({ timeout: 60_000 });
  await expect(list(other.page).getByText("Daniel Brooks")).toHaveCount(0);

  const them = await api(request, await token(request, f.recipient.address));
  const shared = (await (await them.get("/contacts?scope=shared")).json()).data.items[0];
  expect((await request.patch(`${API}/contacts/${shared.id}`, {
    headers: { Authorization: `Bearer ${await token(request, f.recipient.address)}`, "Idempotency-Key": key("ct") },
    data: { company: "Changed" },
  })).status()).toBe(403);
  await other.context.close();
});

test("recent communications, Email and Schedule, and Other Contacts come from one's own mail", async ({ browser, request }) => {
  const f = getFixture();
  const me = await api(request, await token(request, f.sender.address));
  const draft = await (await me.post("/mail/drafts", {
    subject: "Product delivery check-in",
    textBody: "Hello",
    recipients: { to: [f.recipient.address, "client@outside.example"] },
  })).json();
  await me.post(`/mail/drafts/${draft.data.id}/send`, {});

  const { page, context } = await signIn(browser, f.sender.address, f.password);
  await page.setViewportSize({ width: 1600, height: 950 });
  await openContacts(page, "?view=directory");
  await list(page).getByText(f.recipient.address).click();
  const activity = details(page).getByTestId("activity-list");
  await expect(activity).toContainText("Product delivery check-in", { timeout: 60_000 });

  // The activity item opens that message in Mail.
  await activity.getByRole("link", { name: /Product delivery check-in/ }).click();
  await expect(page).toHaveURL(/\/mail$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Product delivery check-in" })).toBeVisible({ timeout: 60_000 });

  // Email opens a new message to them.
  await openContacts(page, "?view=directory");
  await list(page).getByText(f.recipient.address).click();
  await details(page).getByRole("link", { name: "Email", exact: true }).click();
  await expect(page).toHaveURL(/\/mail$/, { timeout: 60_000 });
  const composer = page.getByRole("dialog").filter({ has: page.getByPlaceholder(/subject/i) });
  await expect(composer.getByText(f.recipient.address)).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press("Escape");

  // Schedule opens a new meeting with them invited.
  await openContacts(page, "?view=directory");
  await list(page).getByText(f.recipient.address).click();
  await details(page).getByRole("link", { name: "Schedule", exact: true }).click();
  await expect(page).toHaveURL(/\/mail\/calendar$/, { timeout: 90_000 });
  await expect(page.getByRole("dialog")).toContainText(f.recipient.address, { timeout: 60_000 });
  await page.keyboard.press("Escape");

  // The outside address is "other" until it is saved.
  await openContacts(page, "?view=other");
  await expect(list(page).getByText("client@outside.example")).toBeVisible({ timeout: 60_000 });
  await list(page).getByText("client@outside.example").click();
  await details(page).getByRole("button", { name: "Save" }).click();
  const dialog = page.getByRole("dialog", { name: "New contact" });
  await expect(dialog.getByLabel("Email")).toHaveValue("client@outside.example");
  await dialog.getByLabel("First name").fill("Client");
  await dialog.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByTestId("contacts-empty")).toBeVisible({ timeout: 60_000 });
  const saved = (await (await me.get("/contacts?q=client%40outside")).json()).data.items[0];
  expect(saved).toMatchObject({ firstName: "Client", source: "MAIL" });
  await context.close();
});

test("import and export a CSV, merge duplicates, and delete with confirmation", async ({ browser, request }) => {
  const f = getFixture();
  const { page, context } = await signIn(browser, f.sender.address, f.password);
  await page.setViewportSize({ width: 1600, height: 950 });

  await openContacts(page);
  await page.getByRole("link", { name: "Import Contacts" }).click();
  await expect(page.getByTestId("import-export")).toBeVisible({ timeout: 60_000 });
  const csv = [
    "First Name,Last Name,E-mail Address,Company,Groups",
    "Emma,Roberts,emma.roberts@example.com,Example Corporation,Colleagues",
    "James,Wilson,james.wilson@example.net,Bridgepoint Partners,",
    "james,wilson,jw@home.example,,",
    "Bad,Row,not-an-email,,",
  ].join("\n");
  await page.locator("#contacts-import-file").setInputFiles({ name: "contacts.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByTestId("import-preview")).toContainText("4 rows found");
  await page.getByRole("button", { name: "Import 4 contacts" }).click();
  await expect(page.getByTestId("import-result")).toContainText("3 imported, 1 skipped", { timeout: 60_000 });
  await expect(page.getByTestId("import-result")).toContainText("Line 5 (not-an-email)");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const file = await download;
  const text = await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString("utf8"));
  expect(text).toContain("emma.roberts@example.com");
  expect(text).toContain("First name,Last name,Email");

  // The two James Wilsons are one person.
  await page.getByRole("link", { name: "Review Duplicates" }).click();
  await expect(page.getByTestId("duplicates")).toContainText("Same name", { timeout: 60_000 });
  await page.getByRole("button", { name: "Merge 2 contacts" }).click();
  await page.getByRole("dialog", { name: "Merge these contacts?" }).getByRole("button", { name: "Merge" }).click();
  await expect(page.getByTestId("duplicates-empty")).toBeVisible({ timeout: 60_000 });

  // Delete asks first; Cancel keeps it.
  await openContacts(page, "?view=mine");
  await list(page).getByText("Emma Roberts").click();
  await details(page).getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Delete contact" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete Emma?" });
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(list(page).getByText("Emma Roberts")).toBeVisible();
  await details(page).getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Delete contact" }).click();
  await page.getByRole("dialog", { name: "Delete Emma?" }).getByRole("button", { name: "Delete contact" }).click();
  await expect(page.getByTestId("contacts-notice")).toContainText("Contact deleted");
  await expect(list(page).getByText("Emma Roberts")).toHaveCount(0);

  const me = await api(request, await token(request, f.sender.address));
  const left = (await (await me.get("/contacts?q=wilson")).json()).data.items;
  expect(left).toHaveLength(1);
  expect((await (await me.get("/contacts?q=emma")).json()).data.items).toHaveLength(0);
  await context.close();
});

test("on a phone the list and the details take turns", async ({ browser }) => {
  const f = getFixture();
  const { page, context } = await signIn(browser, f.sender.address, f.password);
  await page.setViewportSize({ width: 390, height: 844 });
  await openContacts(page);
  await expect(list(page).getByText("Sarah Chen")).toBeVisible({ timeout: 60_000 });
  await expect(details(page)).toBeHidden();
  await list(page).getByText("Sarah Chen").click();
  await expect(details(page).getByTestId("contact-details-name")).toHaveText("Sarah Chen");
  await expect(list(page)).toBeHidden();
  await details(page).getByRole("button", { name: "Back to the list" }).click();
  await expect(list(page)).toBeVisible();
  // The sidebar's lists are a picker on a phone.
  await page.getByLabel("Contacts list").selectOption("favorites");
  await expect(page).toHaveURL(/view=favorites/, { timeout: 60_000 });
  await context.close();
});
