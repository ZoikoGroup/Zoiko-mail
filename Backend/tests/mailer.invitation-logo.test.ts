import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { systemMailer } from "../src/common/mailer/system-mailer.js";
import { draftInvitationLetter } from "../src/modules/membership/invitation-letter.js";

/**
 * How the invitation email carries its logo.
 *
 * The bug this pins down reached a real inbox: the wordmark was a remote
 * <img> pointing at APP_URL, which defaults to http://localhost:3000 in
 * development. Gmail fetches images through its own servers, so that URL
 * resolved to their proxy's own machine, nothing was found, and the recipient
 * saw the alt text where the logo should be.
 *
 * Attaching the image instead means it travels with the message and needs no
 * fetch, so it renders regardless of whether the app is publicly reachable.
 */
describe("the invitation email's logo", () => {
  const letter = draftInvitationLetter({
    firstName: "Priya",
    lastName: "Sharma",
    email: "priya@example.com",
    role: "MEMBER",
    workspaceName: "Acme Corp",
    inviterName: "Devon Blake",
    expiresInHours: 72,
  });

  /** Captures the payload without going near a transport. */
  async function capture() {
    const spy = vi.spyOn(systemMailer, "send").mockResolvedValue(undefined);
    try {
      await systemMailer.sendInvitationEmail(
        "priya@example.com",
        letter,
        "https://app.example.com/accept-invitation?token=abc"
      );
      expect(spy).toHaveBeenCalledOnce();
      return spy.mock.calls[0]![0];
    } finally {
      spy.mockRestore();
    }
  }

  it("attaches the wordmark and references it by content id", async () => {
    const mail = await capture();

    expect(mail.attachments).toHaveLength(1);
    const [logo] = mail.attachments!;
    expect(logo!.cid).toBe("zoiko-wordmark");
    expect(mail.html).toContain(`src="cid:${logo!.cid}"`);
  });

  it("attaches a file that actually exists on disk", async () => {
    const mail = await capture();

    // A cid pointing at a missing attachment is the same broken image by
    // another route, so the path is resolved rather than assumed. This also
    // catches the asset not being carried into the Docker image.
    expect(existsSync(mail.attachments![0]!.path)).toBe(true);
  });

  it("never points the logo at a URL", async () => {
    const mail = await capture();

    // The specific regression: any http(s) <img> source depends on the app
    // being reachable from the recipient's mail provider, which is not true
    // in development and not guaranteed anywhere.
    expect(mail.html).not.toMatch(/<img[^>]+src="https?:/i);
    expect(mail.html).not.toContain("localhost");
  });

  it("still links the accept button, which is a link and not an image", async () => {
    const mail = await capture();

    // Worth separating: a link the recipient clicks is fine on any host they
    // can reach, and it is only images that the provider fetches for them.
    expect(mail.html).toContain('href="https://app.example.com/accept-invitation?token=abc"');
    expect(mail.text).toContain("https://app.example.com/accept-invitation?token=abc");
  });
});
