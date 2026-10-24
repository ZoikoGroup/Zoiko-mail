import { describe, expect, it } from "vitest";
import { snippetFrom, withoutQuotedHistory } from "../src/modules/message/message.utils.js";

/**
 * List snippets show a message's own words, not the history it quotes. The
 * shapes below are the ones the composer writes for a reply (text and HTML),
 * as stored for a real conversation.
 */
describe("list snippets", () => {
  const replyText = "check these files\n\nOn Oct 23, 2026, 12:59 PM, management@temveris.com wrote:\n> got replied mail\n> \n> On Oct 14, 2026, 6:36 PM, info@temveris.com wrote:\n> > first message";
  const replyHtml = "<p>check these files</p><p>On Oct 23, 2026, 12:59 PM, management@temveris.com wrote:</p><blockquote>got replied mail<br><br>On Oct 14, 2026, 6:36 PM, info@temveris.com wrote:<br>&gt; first message</blockquote>";

  it("is the reply's own text, without the quoted conversation", () => {
    expect(snippetFrom(replyText, replyHtml)).toBe("check these files");
  });

  it("finds the quote in HTML-only mail too", () => {
    expect(snippetFrom(null, replyHtml)).toBe("check these files");
  });

  it("is empty for a reply that only quotes", () => {
    const onlyQuote = "\n\nOn Oct 14, 2026, 6:36 PM, info@temveris.com wrote:\n> first message";
    expect(snippetFrom(onlyQuote, "<p>On Oct 14, 2026, 6:36 PM, info@temveris.com wrote:</p><blockquote>first message</blockquote>")).toBeNull();
  });

  it("stops at a forwarded-message separator", () => {
    expect(withoutQuotedHistory("FYI below\n\n---------- Forwarded message ---------\nFrom: a@b.test")).toBe("FYI below");
  });

  it("leaves ordinary mail alone", () => {
    expect(snippetFrom("Hello team,\nThe launch is on Friday.", null)).toBe("Hello team, The launch is on Friday.");
    expect(snippetFrom(null, "<p>Hello <b>team</b></p><p>See you</p>")).toBe("Hello team See you");
  });
});
