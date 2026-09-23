import { test, expect, type Page } from "@playwright/test";
import { API, json, signInAsAdmin } from "./admin-harness";

/**
 * The admin screens that had no browser coverage at all.
 *
 * Groups, commitments, inbox, notifications and permissions were each reachable
 * from the nav and never driven. These are deliberately shallow — the deep
 * assertions live with the screens that take destructive actions — but they
 * close the failure that shallow tests are actually good at catching: a screen
 * that throws during hydration and renders nothing.
 *
 * That failure reads as "element not found", which looks like a selector
 * problem and is really a component crash, usually from a response missing a
 * field the screen calls `.map` on. Every spec here listens for pageerror so
 * the diagnosis arrives with the failure instead of after an hour of it.
 */

interface Screen {
  path: string;
  heading: string;
  /** Endpoints this screen must actually call — a screen that reads nothing is suspect. */
  reads: string[];
  stub?: (page: Page) => Promise<void>;
}

const SCREENS: Screen[] = [
  {
    path: "/admin/groups",
    heading: "Groups",
    reads: ["/mail/admin/shared-mailboxes"],
    stub: async (page) => {
      await page.route(`${API}/mail/admin/shared-mailboxes`, (route) =>
        route.fulfill(json({ mailboxes: [] }))
      );
    },
  },
  {
    path: "/admin/commitments",
    heading: "Commitments",
    reads: [],
    stub: async (page) => {
      await page.route(`${API}/actions**`, (route) => route.fulfill(json({ actions: [] })));
    },
  },
  {
    path: "/admin/notifications",
    heading: "Notifications",
    reads: [],
    stub: async (page) => {
      await page.route(`${API}/notifications**`, (route) =>
        route.fulfill(json({ notifications: [] }))
      );
    },
  },
  {
    path: "/admin/permissions",
    heading: "Roles & permissions",
    reads: [],
  },
];

for (const screen of SCREENS) {
  test.describe(screen.path, () => {
    test("renders without throwing, and reads what it needs", async ({ page }) => {
      const errors: string[] = [];
      const called: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await signInAsAdmin(page);
      page.on("request", (r) => called.push(r.url()));
      if (screen.stub) await screen.stub(page);

      await page.goto(screen.path);
      await expect(
        page.getByRole("heading", { level: 1, name: screen.heading })
      ).toBeVisible({ timeout: 20_000 });

      // A component that throws mid-render leaves a heading and an empty body,
      // so the heading alone is not evidence the screen works.
      expect(errors, `page threw while rendering ${screen.path}`).toEqual([]);

      for (const read of screen.reads) {
        expect(
          called.some((url) => url.includes(read)),
          `${screen.path} should read ${read}`
        ).toBe(true);
      }
    });
  });
}

test.describe("/admin/permissions", () => {
  test("describes the matrix without offering to change it", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/permissions");
    await expect(page.getByRole("heading", { level: 1, name: "Roles & permissions" })).toBeVisible();

    // This screen is a reference, not an editor. The matrix is served by the
    // backend and changing it is a code change with a test behind it — a
    // control here would imply otherwise.
    await expect(page.getByRole("button", { name: /save|edit|grant|revoke/i })).toHaveCount(0);
  });
});

test.describe("admin inbox", () => {
  test("renders the admin's own mail without throwing", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await signInAsAdmin(page);
    await page.route(`${API}/mail**`, (route) => route.fulfill(json({ messages: [], nextCursor: null })));
    await page.route(`${API}/mail/unread-counts`, (route) => route.fulfill(json({ counts: {} })));

    await page.goto("/admin/inbox");
    await page.waitForTimeout(2500);
    expect(errors, "the admin inbox threw while rendering").toEqual([]);
  });
});
