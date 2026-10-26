import type { Contact, ContactSource, ImportRow } from "./contacts-api";
import { avatarInitials, hashColor } from "@/components/mail/MailRow";

/** "Sarah Chen", or the address when no name was given. */
export function contactName(contact: Pick<Contact, "firstName" | "lastName" | "email">): string {
  const name = [contact.firstName, contact.lastName].filter((part) => part?.trim()).join(" ").trim();
  return name || contact.email;
}

/** "Product Director · Example Corporation", whichever parts exist. */
export function roleLine(jobTitle: string | null | undefined, company: string | null | undefined): string {
  return [jobTitle, company].filter((part) => part?.trim()).join(" · ");
}

export { avatarInitials as initialsOf, hashColor as colorFor };

export const SOURCE_LABEL: Record<ContactSource, string> = {
  MANUAL: "Personal address book",
  IMPORT: "Imported",
  MAIL: "Saved from mail",
};

// ── CSV ─────────────────────────────────────────────────────────────────────

/** Split CSV text into rows of cells: quoted cells, doubled quotes and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * Header names this importer understands, including the ones Google
 * Contacts and Outlook exports use, so their files import as they are.
 */
const HEADER_ALIASES: Record<keyof ImportRow, string[]> = {
  firstName: ["first name", "firstname", "given name", "first"],
  lastName: ["last name", "lastname", "family name", "surname", "last"],
  email: ["email", "e-mail", "email address", "e-mail address", "e-mail 1 - value", "email 1", "primary email"],
  phone: ["phone", "phone number", "mobile", "mobile phone", "phone 1 - value", "business phone", "telephone"],
  company: ["company", "organization", "organisation", "organization 1 - name", "organization name"],
  jobTitle: ["job title", "jobtitle", "title", "role", "organization 1 - title"],
  notes: ["notes", "note"],
  tags: ["groups", "group", "tags", "labels", "group membership", "categories"],
};

export interface ParsedImport {
  rows: ImportRow[];
  /** Columns that were recognised, for the preview. */
  columns: (keyof ImportRow)[];
  /** Why the file cannot be imported, if it cannot. */
  problem: string | null;
}

export function parseContactsCsv(text: string): ParsedImport {
  const table = parseCsv(text);
  if (table.length === 0) return { rows: [], columns: [], problem: "The file is empty." };
  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const index = {} as Partial<Record<keyof ImportRow, number>>;
  for (const [field, names] of Object.entries(HEADER_ALIASES) as [keyof ImportRow, string[]][]) {
    const at = header.findIndex((h) => names.includes(h));
    if (at >= 0) index[field] = at;
  }
  // A single "Name" column is split into first and last.
  const nameAt = header.findIndex((h) => h === "name" || h === "full name" || h === "display name");
  if (index.email === undefined) {
    return { rows: [], columns: [], problem: "No email column found. The first row must name the columns, with one called Email." };
  }
  const cell = (row: string[], field: keyof ImportRow) => {
    const at = index[field];
    const value = at === undefined ? "" : (row[at] ?? "").trim();
    return value || undefined;
  };
  const rows = table.slice(1).map((row) => {
    let firstName = cell(row, "firstName");
    let lastName = cell(row, "lastName");
    if (!firstName && !lastName && nameAt >= 0) {
      const parts = (row[nameAt] ?? "").trim().split(/\s+/).filter(Boolean);
      firstName = parts[0];
      lastName = parts.slice(1).join(" ") || undefined;
    }
    const tags = cell(row, "tags")
      ?.split(/[;|]|:::/)
      .map((t) => t.replace(/^\*\s*/, "").trim())
      .filter((t) => t && !/^\* ?my contacts$/i.test(t) && t.toLowerCase() !== "my contacts");
    return {
      firstName,
      lastName,
      email: cell(row, "email") ?? "",
      phone: cell(row, "phone"),
      company: cell(row, "company"),
      jobTitle: cell(row, "jobTitle"),
      notes: cell(row, "notes"),
      tags: tags?.length ? tags : undefined,
    } satisfies ImportRow;
  });
  if (rows.length === 0) return { rows: [], columns: [], problem: "The file has a header row but no contacts." };
  const columns = (Object.keys(index) as (keyof ImportRow)[]).concat(
    nameAt >= 0 && index.firstName === undefined ? ["firstName"] : []
  );
  return { rows, columns, problem: null };
}

function csvCell(value: string | null | undefined): string {
  const text = value ?? "";
  // A leading = + - @ would run as a formula when the file is opened in a spreadsheet.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function contactsToCsv(contacts: Contact[]): string {
  const header = ["First name", "Last name", "Email", "Phone", "Company", "Job title", "Groups", "Notes", "Visibility", "Favourite"];
  const lines = contacts.map((c) =>
    [
      c.firstName,
      c.lastName,
      c.email,
      c.phone,
      c.company,
      c.jobTitle,
      c.tags.join("; "),
      c.notes,
      c.visibility === "SHARED" ? "Shared" : "Personal",
      c.isFavorite ? "Yes" : "",
    ]
      .map(csvCell)
      .join(",")
  );
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}

/** Saves text as a file in the browser. */
export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob(["﻿", text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
