/**
 * Parses operators typed into the search box into the filter params
 * MailClient already sends to GET /mail (from, to, hasAttachment, dateAfter,
 * dateBefore, unreadOnly, starredOnly) plus whatever free text is left over
 * as `q`. No backend change needed — every one of these params already
 * exists on ListMailParams; this only decides how to fill them in from one
 * text box instead of several separate controls.
 *
 * Supported operators (case-insensitive key, as typed):
 *   from:hr            → from
 *   to:someone@x.com   → to
 *   has:attachment      → hasAttachment = true
 *   is:unread           → unreadOnly = true
 *   is:starred          → starredOnly = true
 *   after:2026-10-01    → dateAfter (passed through as typed; the date
 *                          input's own value already uses this format, so
 *                          no reformatting happens here)
 *   before:2026-10-01   → dateBefore
 *
 * An operator with no value (e.g. a bare "from:") is left as plain text
 * rather than producing an empty filter — better to search for the literal
 * string than to silently drop it.
 */
export interface ParsedMailQuery {
  q: string;
  from: string;
  to: string;
  hasAttachment: boolean;
  dateAfter: string;
  dateBefore: string;
  unreadOnly: boolean;
  starredOnly: boolean;
}

const OPERATOR = /(from|to|has|is|after|before):(\S+)/gi;

export function parseMailQuery(raw: string): ParsedMailQuery {
  const result: ParsedMailQuery = {
    q: "",
    from: "",
    to: "",
    hasAttachment: false,
    dateAfter: "",
    dateBefore: "",
    unreadOnly: false,
    starredOnly: false,
  };

  const leftover = raw.replace(OPERATOR, (match, key: string, value: string) => {
    switch (key.toLowerCase()) {
      case "from":
        result.from = value;
        return "";
      case "to":
        result.to = value;
        return "";
      case "has":
        if (value.toLowerCase() === "attachment") {
          result.hasAttachment = true;
          return "";
        }
        return match; // unknown has: value — keep as literal text
      case "is":
        if (value.toLowerCase() === "unread") {
          result.unreadOnly = true;
          return "";
        }
        if (value.toLowerCase() === "starred") {
          result.starredOnly = true;
          return "";
        }
        return match; // unknown is: value — keep as literal text
      case "after":
        result.dateAfter = value;
        return "";
      case "before":
        result.dateBefore = value;
        return "";
      default:
        return match;
    }
  });

  result.q = leftover.replace(/\s+/g, " ").trim();
  return result;
}