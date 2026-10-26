"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  Copy,
  Mail,
  Pencil,
  ShieldCheck,
  Star,
  Trash2,
  UserPlus,
  UsersRound,
  UserRound,
} from "lucide-react";
import type { Contact, DirectoryPerson, OtherContact } from "@/lib/contacts-api";
import { useContactActivity } from "@/lib/contacts-hooks";
import { SOURCE_LABEL, colorFor, contactName, initialsOf, roleLine } from "@/lib/contact-format";

/** Whoever is selected: a saved contact, a colleague, or someone from one's mail. */
export type Person =
  | { kind: "contact"; contact: Contact }
  | { kind: "directory"; person: DirectoryPerson }
  | { kind: "other"; other: OtherContact };

export function personKey(p: Person): string {
  return p.kind === "contact" ? `c:${p.contact.id}` : p.kind === "directory" ? `d:${p.person.membershipId}` : `o:${p.other.email}`;
}

export function personName(p: Person): string {
  if (p.kind === "contact") return contactName(p.contact);
  if (p.kind === "directory") return p.person.name;
  return p.other.name || p.other.email;
}

export function personEmail(p: Person): string {
  return p.kind === "contact" ? p.contact.email : p.kind === "directory" ? p.person.email : p.other.email;
}

export type Badge = "Personal" | "Shared" | "Directory" | "Other";

export function personBadge(p: Person): Badge {
  if (p.kind === "directory") return "Directory";
  if (p.kind === "other") return "Other";
  return p.contact.visibility === "SHARED" ? "Shared" : "Personal";
}

const BADGE_STYLE: Record<Badge, string> = {
  Personal: "border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent-ink)]",
  Directory: "border-[var(--border)] bg-[var(--s2)] text-[var(--ink2)]",
  Shared: "border-[var(--ok)]/40 bg-[var(--ok-soft)] text-[var(--ok)]",
  Other: "border-[var(--warn)]/40 bg-[var(--warn-soft)] text-[var(--warn)]",
};

export function VisibilityBadge({ badge }: { badge: Badge }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${BADGE_STYLE[badge]}`}>{badge}</span>
  );
}

export function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  const dims = size === "lg" ? "h-[60px] w-[60px] text-[20px]" : "h-9 w-9 text-[12px]";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${dims}`}
      style={{ backgroundColor: colorFor(name) }}
      aria-hidden
    >
      {initialsOf(name)}
    </span>
  );
}

const when = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric" });
const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Folders Mail can open a linked message in. */
const MAIL_FOLDER: Record<string, string> = { INBOX: "INBOX", SENT: "SENT", ARCHIVE: "ARCHIVE", TRASH: "TRASH" };

function headerLabel(p: Person): string {
  if (p.kind === "directory") return "Workspace member";
  if (p.kind === "other") return "From your mail";
  if (!p.contact.owned) return `Shared by ${p.contact.ownerName ?? "a colleague"}`;
  return p.contact.visibility === "SHARED" ? "Shared contact" : "Personal contact";
}

function sourceLabel(p: Person): string {
  if (p.kind === "directory") return "Workspace directory";
  if (p.kind === "other") return `Your mail · ${p.other.messageCount} message${p.other.messageCount === 1 ? "" : "s"}`;
  if (!p.contact.owned) return `Shared by ${p.contact.ownerName ?? "a colleague"}`;
  return SOURCE_LABEL[p.contact.source];
}

export function ContactDetails({
  person,
  onBack,
  onEdit,
  onSave,
  onDelete,
  onToggleFavorite,
  onToggleShared,
  onCopied,
  busy,
}: {
  person: Person | null;
  /** Phone and tablet: back to the list. */
  onBack?: () => void;
  onEdit: (contact: Contact) => void;
  /** Save a colleague or a correspondent as a contact. */
  onSave: (person: Person) => void;
  onDelete: (contact: Contact) => void;
  onToggleFavorite: (contact: Contact) => void;
  onToggleShared: (contact: Contact) => void;
  onCopied: (ok: boolean) => void;
  busy: boolean;
}) {
  const email = person ? personEmail(person) : null;
  const activity = useContactActivity(email);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menuOpen]);
  const selectedKey = person ? personKey(person) : null;
  useEffect(() => setMenuOpen(false), [selectedKey]);

  if (!person) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center text-[var(--ink3)]" data-testid="contact-details-empty">
        <UserRound className="h-10 w-10" aria-hidden />
        <p className="mt-3 text-[13px]">Select a person to see their details and your recent conversations.</p>
      </div>
    );
  }

  const name = personName(person);
  const contact = person.kind === "contact" ? person.contact : null;
  const ownContact = contact?.owned ? contact : null;
  const role = contact ? roleLine(contact.jobTitle, contact.company) : person.kind === "directory" ? "Member of your workspace" : "";
  const saved = person.kind === "directory" && person.person.savedContactId;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(email!);
      onCopied(true);
    } catch {
      onCopied(false);
    }
  };

  const info: [string, string | null][] = [
    ["Email", email],
    ["Phone", contact?.phone ?? null],
    ["Company", contact?.company ?? null],
    ["Job title", contact?.jobTitle ?? null],
    ["Groups", contact?.tags.length ? contact.tags.join(", ") : null],
    ["Source", sourceLabel(person)],
  ];
  const items = activity.data
    ? [
        ...activity.data.messages.map((m) => ({
          key: `m:${m.messageId}`,
          title: m.subject,
          meta: `Email · ${when.format(new Date(m.at))}`,
          href: MAIL_FOLDER[m.folder] ? `/mail?open=${m.messageId}&folder=${MAIL_FOLDER[m.folder]}` : "/mail",
          at: m.at,
          icon: Mail,
        })),
        ...activity.data.events.map((e) => ({
          key: `e:${e.eventId}`,
          title: e.title,
          meta: `Calendar · ${when.format(new Date(e.startsAt))}`,
          href: `/mail/calendar?date=${dayKey(e.startsAt)}`,
          at: e.startsAt,
          icon: CalendarDays,
        })),
      ]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 5)
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="contact-details">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-4">
        <div className="flex items-center gap-2">
          {onBack && (
            <button type="button" onClick={onBack} className="rounded-md p-1 text-[var(--ink2)] hover:bg-[var(--s2)] xl:hidden" aria-label="Back to the list">
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </button>
          )}
          <h2 className="text-[16px] font-semibold text-[var(--ink)]">Contact details</h2>
        </div>
        <span className="text-[12px] text-[var(--ink3)]">{headerLabel(person)}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="flex items-start gap-4">
          <Avatar name={name} size="lg" />
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 truncate text-[20px] font-semibold text-[var(--ink)]" data-testid="contact-details-name">
              <span className="truncate">{name}</span>
              {ownContact?.isFavorite && <Star className="h-4 w-4 shrink-0 fill-[var(--warn)] text-[var(--warn)]" aria-label="Favourite" />}
            </h3>
            {role && <p className="mt-0.5 truncate text-[13px] text-[var(--ink2)]">{role}</p>}
            <div className="mt-2">
              <VisibilityBadge badge={personBadge(person)} />
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2">
          <Link href={`/mail?compose=${encodeURIComponent(email!)}`} className="zoiko-btn pri justify-center py-2.5 text-[13px]">
            <Mail className="h-4 w-4" aria-hidden /> Email
          </Link>
          <Link href={`/mail/calendar?invite=${encodeURIComponent(email!)}`} className="zoiko-btn justify-center py-2.5 text-[13px]">
            <CalendarDays className="h-4 w-4" aria-hidden /> Schedule
          </Link>
          {ownContact ? (
            <button type="button" onClick={() => onEdit(ownContact)} className="zoiko-btn justify-center py-2.5 text-[13px]">
              <Pencil className="h-4 w-4" aria-hidden /> Edit
            </button>
          ) : saved ? (
            <span className="zoiko-btn cursor-default justify-center py-2.5 text-[13px] opacity-70" title="Already in your contacts">
              Saved
            </span>
          ) : (
            <button type="button" onClick={() => onSave(person)} className="zoiko-btn justify-center py-2.5 text-[13px]" disabled={busy}>
              <UserPlus className="h-4 w-4" aria-hidden /> Save
            </button>
          )}
        </div>

        <h4 className="mt-6 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink3)]">Contact information</h4>
        <dl className="mt-2 grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-[13px]">
          {info.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-[var(--ink3)]">{label}</dt>
              <dd className={`min-w-0 break-words ${value ? "text-[var(--ink)]" : "text-[var(--ink3)]"}`}>{value ?? "Not provided"}</dd>
            </div>
          ))}
        </dl>
        {contact?.notes && (
          <>
            <h4 className="mt-5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink3)]">Notes</h4>
            <p className="mt-1.5 whitespace-pre-wrap text-[13px] text-[var(--ink2)]">{contact.notes}</p>
          </>
        )}

        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink3)]">Recent communications</h4>
          {activity.isLoading ? (
            <p className="mt-3 text-[12.5px] text-[var(--ink3)]" role="status">Loading…</p>
          ) : activity.isError ? (
            <p className="mt-3 text-[12.5px] text-[var(--crit)]">
              Could not load recent communications.{" "}
              <button type="button" onClick={() => activity.refetch()} className="underline">Try again</button>
            </p>
          ) : items.length === 0 ? (
            <p className="mt-3 text-[12.5px] text-[var(--ink3)]" data-testid="activity-empty">No mail or meetings with {name} yet.</p>
          ) : (
            <ul className="mt-2 space-y-1" data-testid="activity-list">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.key}>
                    <Link href={item.href} className="flex items-start gap-3 rounded-lg px-1 py-2 hover:bg-[var(--s2)]">
                      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--s2)] text-[var(--accent-ink)]">
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-[var(--ink)]">{item.title}</span>
                        <span className="text-[11.5px] text-[var(--ink3)]">{item.meta}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="mt-4 flex gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--s2)] p-3 text-[12px] leading-relaxed text-[var(--ink2)]">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-ink)]" aria-hidden />
          <p>
            Directory membership does not grant access to another person&apos;s private emails, calendar events or contacts.
            Recent communications come from your own mailbox and calendar only.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-5 py-3">
        <span className="truncate text-[12px] text-[var(--ink3)]">
          {contact ? `Added ${when.format(new Date(contact.createdAt))}` : person.kind === "other" ? `Last contact ${when.format(new Date(person.other.lastAt))}` : "Workspace directory"}
        </span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={copy} className="zoiko-btn">
            <Copy className="h-3.5 w-3.5" aria-hidden /> Copy Email
          </button>
          {ownContact && (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="zoiko-btn"
                disabled={busy}
              >
                More <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </button>
              {menuOpen && (
                <div role="menu" className="absolute bottom-full right-0 z-30 mb-2 w-56 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--sh3)]">
                  <MenuItem icon={Star} onClick={() => { setMenuOpen(false); onToggleFavorite(ownContact); }}>
                    {ownContact.isFavorite ? "Remove from Favourites" : "Add to Favourites"}
                  </MenuItem>
                  <MenuItem icon={ownContact.visibility === "SHARED" ? UserRound : UsersRound} onClick={() => { setMenuOpen(false); onToggleShared(ownContact); }}>
                    {ownContact.visibility === "SHARED" ? "Make personal" : "Share with workspace"}
                  </MenuItem>
                  <MenuItem icon={Pencil} onClick={() => { setMenuOpen(false); onEdit(ownContact); }}>
                    Edit
                  </MenuItem>
                  <div className="my-1 border-t border-[var(--border)]" />
                  <MenuItem icon={Trash2} danger onClick={() => { setMenuOpen(false); onDelete(ownContact); }}>
                    Delete contact
                  </MenuItem>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MenuItem({
  icon: Icon,
  onClick,
  danger,
  children,
}: {
  icon: typeof Star;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-[var(--s2)] ${danger ? "text-[var(--crit)]" : "text-[var(--ink)]"}`}
    >
      <Icon className="h-4 w-4" aria-hidden /> {children}
    </button>
  );
}
