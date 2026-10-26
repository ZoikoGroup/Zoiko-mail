"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  Lock,
  Plus,
  Search,
  Star,
  Tags,
  Users,
  X,
} from "lucide-react";
import { WebmailShell } from "@/components/mail/WebmailShell";
import {
  useContactPages,
  useContactSummary,
  useDeleteContact,
  useDirectory,
  useOtherContacts,
  useUpdateContact,
} from "@/lib/contacts-hooks";
import type { Contact, ContactScope, ContactSort } from "@/lib/contacts-api";
import { roleLine } from "@/lib/contact-format";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ContactsSidebar, CONTACTS_VIEWS, VIEW_LABEL, viewHref, type ContactsView } from "./ContactsSidebar";
import { ContactDialog, errorText, type ContactSeed } from "./ContactDialog";
import {
  Avatar,
  ContactDetails,
  VisibilityBadge,
  personBadge,
  personEmail,
  personKey,
  personName,
  type Person,
} from "./ContactDetails";
import { DuplicatesPanel, ImportExportPanel } from "./ContactTools";

/** Which saved contacts each list shows. Directory and Other are not saved contacts. */
const SCOPE: Partial<Record<ContactsView, ContactScope>> = {
  all: "all",
  mine: "mine",
  favorites: "favorites",
  personal: "personal",
  shared: "shared",
  groups: "all",
};

const SUBTITLE: Record<ContactsView, string> = {
  all: "Your contacts, contacts shared with the workspace, and your colleagues.",
  mine: "Contacts you added, whether personal or shared with the workspace.",
  favorites: "The contacts you starred.",
  directory: "Everyone in your workspace.",
  groups: "Contacts organised by group.",
  personal: "Contacts only you can see.",
  shared: "Contacts shared with everyone in the workspace. Only the person who shared one can change it.",
  other: "People you have emailed or heard from who are not saved yet. Save them to keep their details.",
  import: "Bring contacts in from a CSV file, or take them out as one.",
  duplicates: "Contacts of yours that look like the same person.",
};

const TABS: { view: ContactsView; label: string }[] = [
  { view: "all", label: "All Contacts" },
  { view: "mine", label: "My Contacts" },
  { view: "directory", label: "Company Directory" },
];

const wide = () => typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches;

type Dialog = { mode: "new"; seed?: ContactSeed } | { mode: "edit"; contact: Contact } | null;
type Notice = { text: string; kind: "ok" | "err" } | null;

export function ContactsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const rawView = params.get("view") as ContactsView | null;
  const view: ContactsView = rawView && CONTACTS_VIEWS.includes(rawView) ? rawView : "all";
  const group = params.get("group") ?? "";

  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<ContactSort>("name");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(input.trim()), 250);
    return () => clearTimeout(t);
  }, [input]);
  // A new list starts unselected and unfiltered.
  useEffect(() => {
    setSelectedKey(null);
    setInput("");
    setQ("");
  }, [view]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);
  const say = (text: string, kind: "ok" | "err" = "ok") => setNotice({ text, kind });

  const summary = useContactSummary();
  const scope = SCOPE[view];
  const isList = !["import", "duplicates"].includes(view);
  const pickingGroup = view === "groups" && !group;
  const contactsQuery = useContactPages(
    { scope, q: q || undefined, sort, tag: view === "groups" ? group : undefined },
    Boolean(scope) && !pickingGroup
  );
  const showDirectory = view === "all" || view === "directory";
  const directory = useDirectory(q, showDirectory);
  const fullDirectory = useDirectory("");
  const other = useOtherContacts(q, view === "other");
  const update = useUpdateContact();
  const remove = useDeleteContact();

  const contacts = useMemo(() => contactsQuery.data?.pages.flatMap((p) => p.items) ?? [], [contactsQuery.data]);
  const contactTotal = contactsQuery.data?.pages[0]?.pagination.total ?? 0;

  const people: Person[] = useMemo(() => {
    if (view === "other") return (other.data ?? []).map((o) => ({ kind: "other" as const, other: o }));
    if (view === "directory") return (directory.data ?? []).map((p) => ({ kind: "directory" as const, person: p }));
    const saved = contacts.map((c) => ({ kind: "contact" as const, contact: c }));
    if (view !== "all") return saved;
    // Colleagues one has not saved join the list; a saved one appears once, as the contact.
    const colleagues = (directory.data ?? [])
      .filter((p) => !p.savedContactId && !contacts.some((c) => c.email === p.email))
      .map((p) => ({ kind: "directory" as const, person: p }));
    const merged: Person[] = [...saved, ...colleagues];
    if (sort === "recent") return merged;
    const companyOf = (p: Person) => (p.kind === "contact" ? p.contact.company ?? "" : "");
    return merged.sort((a, b) =>
      sort === "company"
        ? (companyOf(a) || "￿").localeCompare(companyOf(b) || "￿") || personName(a).localeCompare(personName(b))
        : personName(a).localeCompare(personName(b), undefined, { sensitivity: "base" })
    );
  }, [view, contacts, directory.data, other.data, sort]);

  const active = view === "other" ? other : view === "directory" ? directory : contactsQuery;
  const loading = active.isLoading || (view === "all" && directory.isLoading);
  const failed = active.isError || (view === "all" && directory.isError);

  const selected = people.find((p) => personKey(p) === selectedKey) ?? null;
  // On a wide screen the first person is shown, as the reading pane is never empty.
  useEffect(() => {
    if (!selectedKey && people.length > 0 && wide()) setSelectedKey(personKey(people[0]!));
  }, [people, selectedKey]);

  const groups = summary.data?.groups ?? [];
  const unsavedColleagues = (fullDirectory.data ?? []).filter((p) => !p.savedContactId).length;
  const available = (summary.data?.all ?? 0) + unsavedColleagues;
  const shownTotal =
    view === "all" ? contactTotal + people.filter((p) => p.kind === "directory").length : scope ? contactTotal : people.length;

  const openNew = (seed?: ContactSeed) => setDialog({ mode: "new", seed });
  const saveFrom = (p: Person) => {
    if (p.kind === "directory") {
      const [first, ...rest] = p.person.name.includes("@") ? [] : p.person.name.split(/\s+/);
      openNew({ email: p.person.email, firstName: first, lastName: rest.join(" ") || undefined });
    } else if (p.kind === "other") {
      const [first, ...rest] = (p.other.name ?? "").split(/\s+/).filter(Boolean);
      openNew({ email: p.other.email, firstName: first, lastName: rest.join(" ") || undefined, source: "MAIL" });
    }
  };
  const toggleFavorite = (c: Contact) =>
    update.mutate(
      { id: c.id, input: { isFavorite: !c.isFavorite } },
      {
        onSuccess: (saved) => say(saved.isFavorite ? "Added to Favourites." : "Removed from Favourites."),
        onError: (e) => say(errorText(e), "err"),
      }
    );
  const toggleShared = (c: Contact) =>
    update.mutate(
      { id: c.id, input: { visibility: c.visibility === "SHARED" ? "PERSONAL" : "SHARED" } },
      {
        onSuccess: (saved) =>
          say(saved.visibility === "SHARED" ? "Shared with your workspace." : "Now only you can see this contact."),
        onError: (e) => say(errorText(e), "err"),
      }
    );

  return (
    <WebmailShell section="contacts">
      <div className="flex h-full min-h-0">
        <div className="hidden lg:block">
          <ContactsSidebar active={view} summary={summary.data} onNewContact={() => openNew()} />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-4 pb-4 pt-5 lg:px-6">
          <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--s2)] text-[var(--accent-ink)]">
                <Users className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <h1 className="text-[24px] font-bold leading-tight tracking-tight text-[var(--ink)] sm:text-[28px]">Contacts &amp; People Directory</h1>
                <p className="mt-1 text-[13.5px] text-[var(--ink2)]">Find people, manage relationships and connect with confidence.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={viewHref("import")} className="zoiko-btn px-4 py-2.5 text-[13px]">
                <ArrowDownToLine className="h-4 w-4" aria-hidden /> Import Contacts
              </Link>
              <button type="button" onClick={() => openNew()} className="zoiko-btn pri px-4 py-2.5 text-[13px]">
                <Plus className="h-4 w-4" aria-hidden /> New Contact
              </button>
            </div>
          </header>

          {/* Phone and tablet: the sidebar's lists as a picker. */}
          <label className="mb-3 block lg:hidden">
            <span className="sr-only">Contacts list</span>
            <select className="zoiko-input" value={view} onChange={(e) => router.push(viewHref(e.target.value as ContactsView))}>
              {CONTACTS_VIEWS.map((v) => (
                <option key={v} value={v}>{VIEW_LABEL[v]}</option>
              ))}
            </select>
          </label>

          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-5 py-3.5" data-testid="contacts-summary">
            <p className="flex items-center gap-2 text-[13px] text-[var(--ink2)]">
              <strong className="font-mono-num text-[20px] text-[var(--ink)]" data-testid="contacts-available">
                {summary.isLoading || fullDirectory.isLoading ? "…" : available}
              </strong>
              Contacts available to you
            </p>
            <span className="hidden h-6 w-px bg-[var(--border)] sm:block" aria-hidden />
            <span className="rounded-md border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-2 py-1 text-[11.5px] font-semibold text-[var(--accent-ink)]">
              Personal + permitted directory
            </span>
            <span className="flex items-center gap-1.5 text-[12px] text-[var(--ink3)] sm:ml-auto">
              <Lock className="h-3.5 w-3.5" aria-hidden /> Visibility follows source permissions
            </span>
          </div>

          {notice && (
            <div
              role={notice.kind === "err" ? "alert" : "status"}
              className={`mb-3 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] ${
                notice.kind === "err"
                  ? "border-[var(--crit)]/40 bg-[var(--crit-soft)] text-[var(--crit)]"
                  : "border-[var(--ok)]/40 bg-[var(--ok-soft)] text-[var(--ok)]"
              }`}
              data-testid="contacts-notice"
            >
              {notice.kind === "err" ? <AlertTriangle className="h-4 w-4" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
              <span className="flex-1">{notice.text}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="rounded p-0.5 hover:bg-black/5">
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          )}

          {view === "import" ? (
            <ImportExportPanel onNotice={say} />
          ) : view === "duplicates" ? (
            <DuplicatesPanel onNotice={say} />
          ) : pickingGroup ? (
            <GroupPicker groups={groups} loading={summary.isLoading} onNew={() => openNew()} />
          ) : (
            <div className="flex min-h-[520px] flex-1 gap-4">
              {/* The list. Below xl it gives way to the details when someone is chosen. */}
              <section
                aria-label={VIEW_LABEL[view]}
                className={`min-w-0 flex-1 flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] ${selected ? "hidden xl:flex" : "flex"}`}
              >
                <div className="border-b border-[var(--border)] px-5 pb-0 pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="flex items-center gap-2 text-[17px] font-semibold text-[var(--ink)]">
                        {view === "groups" && <Tags className="h-4 w-4 text-[var(--accent-ink)]" aria-hidden />}
                        {view === "groups" ? group : view === "all" || view === "mine" || view === "directory" ? "People" : VIEW_LABEL[view]}
                      </h2>
                      <p className="mt-0.5 text-[12.5px] text-[var(--ink3)]">
                        {view === "groups" ? (
                          <>
                            Contacts in this group.{" "}
                            <Link href={viewHref("groups")} className="text-[var(--accent-ink)] hover:underline">All groups</Link>
                          </>
                        ) : (
                          SUBTITLE[view]
                        )}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-md border border-[var(--border)] bg-[var(--s2)] px-2 py-1 text-[11.5px] text-[var(--ink2)]" data-testid="contacts-count">
                      {loading ? "…" : `${shownTotal} ${shownTotal === 1 ? "person" : "people"}`}
                    </span>
                  </div>

                  {(view === "all" || view === "mine" || view === "directory") && (
                    <nav aria-label="People" className="mt-3 flex gap-5">
                      {TABS.map((tab) => (
                        <Link
                          key={tab.view}
                          href={viewHref(tab.view)}
                          aria-current={view === tab.view ? "page" : undefined}
                          className={`-mb-px border-b-2 pb-2.5 text-[13.5px] font-semibold transition ${
                            view === tab.view ? "border-[var(--accent)] text-[var(--ink)]" : "border-transparent text-[var(--ink3)] hover:text-[var(--ink)]"
                          }`}
                        >
                          {tab.label}
                        </Link>
                      ))}
                    </nav>
                  )}
                  {!(view === "all" || view === "mine" || view === "directory") && <div className="h-3" />}
                </div>

                <div className="flex flex-wrap gap-2 px-5 py-3">
                  <label className="relative min-w-[180px] flex-1">
                    <span className="sr-only">Search people</span>
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink3)]" aria-hidden />
                    <input
                      type="search"
                      className="zoiko-input py-2.5 !pl-9 text-[13px]"
                      placeholder={view === "directory" ? "Search name or email…" : "Search name, email or company…"}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                    />
                  </label>
                  {scope && view !== "groups" && (
                    <label>
                      <span className="sr-only">Group</span>
                      <select
                        className="zoiko-input py-2.5 text-[13px]"
                        value=""
                        onChange={(e) => e.target.value && router.push(`/mail/contacts?view=groups&group=${encodeURIComponent(e.target.value)}`)}
                      >
                        <option value="">All groups</option>
                        {groups.map((g) => (
                          <option key={g.name} value={g.name}>{g.name} ({g.count})</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {view !== "other" && view !== "directory" && (
                    <label>
                      <span className="sr-only">Sort by</span>
                      <select className="zoiko-input py-2.5 text-[13px]" value={sort} onChange={(e) => setSort(e.target.value as ContactSort)} aria-label="Sort by">
                        <option value="name">Sort: Name</option>
                        <option value="company">Sort: Company</option>
                        <option value="recent">Sort: Recently updated</option>
                      </select>
                    </label>
                  )}
                </div>

                <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1.1fr)_96px] gap-3 border-b border-[var(--border)] px-7 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--ink3)] md:grid">
                  <span>Name / Email</span>
                  <span>{view === "other" ? "Last contact" : "Role / Company"}</span>
                  <span>Visibility</span>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2" data-testid="contacts-list">
                  {loading ? (
                    <ul aria-label="Loading contacts" className="space-y-2 px-2 py-1">
                      {Array.from({ length: 6 }, (_, i) => (
                        <li key={i} className="flex animate-pulse items-center gap-3 py-2">
                          <span className="h-9 w-9 rounded-full bg-[var(--s2)]" />
                          <span className="flex-1 space-y-1.5">
                            <span className="block h-3 w-1/3 rounded bg-[var(--s2)]" />
                            <span className="block h-2.5 w-1/2 rounded bg-[var(--s2)]" />
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : failed ? (
                    <div role="alert" className="flex flex-col items-center px-6 py-12 text-center">
                      <AlertTriangle className="h-8 w-8 text-[var(--crit)]" aria-hidden />
                      <p className="mt-3 text-[13.5px] font-medium text-[var(--ink)]">Could not load {VIEW_LABEL[view].toLowerCase()}.</p>
                      <p className="mt-1 text-[12.5px] text-[var(--ink3)]">{errorText(active.error ?? directory.error)}</p>
                      <button type="button" className="zoiko-btn mt-4" onClick={() => { active.refetch(); if (view === "all") directory.refetch(); }}>
                        Try again
                      </button>
                    </div>
                  ) : people.length === 0 ? (
                    <EmptyList view={view} query={q} onNew={() => openNew()} />
                  ) : (
                    <ul className="space-y-1">
                      {people.map((p) => (
                        <PersonRow
                          key={personKey(p)}
                          person={p}
                          view={view}
                          selected={personKey(p) === selectedKey}
                          onSelect={() => setSelectedKey(personKey(p))}
                        />
                      ))}
                    </ul>
                  )}
                  {contactsQuery.hasNextPage && scope && (
                    <div className="flex justify-center py-3">
                      <button type="button" className="zoiko-btn" onClick={() => contactsQuery.fetchNextPage()} disabled={contactsQuery.isFetchingNextPage}>
                        {contactsQuery.isFetchingNextPage ? "Loading…" : "Show more contacts"}
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-5 py-3 text-[12px] text-[var(--ink3)]">
                  <span data-testid="contacts-showing">
                    Showing {people.length} of {shownTotal} {shownTotal === 1 ? "person" : "people"}
                  </span>
                  <span>Only people within your permitted scope</span>
                </div>
              </section>

              <section
                aria-label="Contact details"
                className={`min-h-0 flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] xl:flex xl:w-[440px] xl:shrink-0 2xl:w-[480px] ${selected ? "flex flex-1 xl:flex-none" : "hidden"}`}
              >
                <ContactDetails
                  person={selected}
                  onBack={() => setSelectedKey(null)}
                  onEdit={(contact) => setDialog({ mode: "edit", contact })}
                  onSave={saveFrom}
                  onDelete={setDeleting}
                  onToggleFavorite={toggleFavorite}
                  onToggleShared={toggleShared}
                  onCopied={(ok) => say(ok ? `${selected ? personEmail(selected) : "Address"} copied.` : "Could not copy. Select the address and copy it instead.", ok ? "ok" : "err")}
                  busy={update.isPending || remove.isPending}
                />
              </section>
            </div>
          )}
        </div>
      </div>

      {dialog && (
        <ContactDialog
          contact={dialog.mode === "edit" ? dialog.contact : null}
          seed={dialog.mode === "new" ? dialog.seed : undefined}
          groups={groups.map((g) => g.name)}
          onClose={() => setDialog(null)}
          onSaved={(saved, created) => {
            setDialog(null);
            say(created ? `${saved.firstName || saved.email} added to your contacts.` : "Contact saved.");
            // Show the saved contact where it is listed.
            if (created && isList && view !== "directory" && view !== "other") setSelectedKey(`c:${saved.id}`);
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting ? deleting.firstName || deleting.email : "contact"}?`}
        message={
          deleting?.visibility === "SHARED"
            ? "The contact is deleted for you and for everyone in the workspace it was shared with. This cannot be undone."
            : "The contact is deleted. Your mail with them is not affected. This cannot be undone."
        }
        confirmLabel="Delete contact"
        loading={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          const target = deleting;
          remove.mutate(target.id, {
            onSuccess: () => {
              say("Contact deleted.");
              if (selectedKey === `c:${target.id}`) setSelectedKey(null);
            },
            onError: (e) => say(errorText(e), "err"),
            onSettled: () => setDeleting(null),
          });
        }}
      />
    </WebmailShell>
  );
}

function PersonRow({ person, view, selected, onSelect }: { person: Person; view: ContactsView; selected: boolean; onSelect: () => void }) {
  const name = personName(person);
  const email = personEmail(person);
  const contact = person.kind === "contact" ? person.contact : null;
  const role =
    person.kind === "contact"
      ? { title: person.contact.jobTitle, company: person.contact.company }
      : person.kind === "directory"
        ? { title: "Workspace member", company: null }
        : {
            title: `${person.other.messageCount} message${person.other.messageCount === 1 ? "" : "s"}`,
            company: new Date(person.other.lastAt).toLocaleDateString(),
          };
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        data-testid="contact-row"
        className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border px-4 py-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.1fr)_96px] ${
          selected
            ? "border-[var(--accent)]/60 bg-[var(--zm-selected,var(--accent-soft))] shadow-[inset_3px_0_0_var(--accent)]"
            : "border-transparent hover:bg-[var(--s2)]"
        }`}
      >
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={name} />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-[13.5px] font-semibold text-[var(--ink)]">{name}</span>
              {contact?.isFavorite && <Star className="h-3.5 w-3.5 shrink-0 fill-[var(--warn)] text-[var(--warn)]" aria-label="Favourite" />}
            </span>
            {name !== email && <span className="block truncate text-[12px] text-[var(--ink3)]">{email}</span>}
            <span className="block truncate text-[11.5px] text-[var(--ink3)] md:hidden">{roleLine(role.title, role.company)}</span>
          </span>
        </span>
        <span className="hidden min-w-0 md:block">
          <span className="block truncate text-[12.5px] text-[var(--ink2)]">{role.title || (view === "other" ? "" : "—")}</span>
          {role.company && <span className="block truncate text-[11.5px] text-[var(--ink3)]">{role.company}</span>}
        </span>
        <span>
          <VisibilityBadge badge={personBadge(person)} />
        </span>
      </button>
    </li>
  );
}

function EmptyList({ view, query, onNew }: { view: ContactsView; query: string; onNew: () => void }) {
  if (query) {
    return (
      <div className="px-6 py-12 text-center" data-testid="contacts-empty">
        <p className="text-[13.5px] font-medium text-[var(--ink)]">No one matches “{query}”.</p>
        <p className="mt-1 text-[12.5px] text-[var(--ink3)]">Try a different name, email or company.</p>
      </div>
    );
  }
  const text: Partial<Record<ContactsView, [string, string]>> = {
    all: ["No contacts yet", "Add the people you work with, or import them from a CSV file."],
    mine: ["No contacts yet", "Add the people you work with, or import them from a CSV file."],
    personal: ["No personal contacts", "Contacts you keep to yourself appear here."],
    favorites: ["No favourites yet", "Open a contact and choose More → Add to Favourites."],
    shared: ["Nothing shared yet", "When someone shares a contact with the workspace, it appears here."],
    directory: ["No colleagues yet", "You are the only member of this workspace."],
    other: ["No one new", "People you email who are not in your contacts or workspace appear here."],
    groups: ["No one in this group", "Edit a contact to add it to this group."],
  };
  const [title, hint] = text[view] ?? ["No one here", ""];
  const canAdd = ["all", "mine", "personal"].includes(view);
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center" data-testid="contacts-empty">
      <Users className="h-9 w-9 text-[var(--ink3)]" aria-hidden />
      <p className="mt-3 text-[14px] font-semibold text-[var(--ink)]">{title}</p>
      <p className="mt-1 max-w-sm text-[12.5px] text-[var(--ink3)]">{hint}</p>
      {canAdd && (
        <div className="mt-4 flex gap-2">
          <button type="button" className="zoiko-btn pri" onClick={onNew}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> New Contact
          </button>
          <Link href={viewHref("import")} className="zoiko-btn">
            Import
          </Link>
        </div>
      )}
    </div>
  );
}

function GroupPicker({ groups, loading, onNew }: { groups: { name: string; count: number }[]; loading: boolean; onNew: () => void }) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5" aria-label="Contact groups" data-testid="group-picker">
      <h2 className="text-[17px] font-semibold text-[var(--ink)]">Contact Groups</h2>
      <p className="mt-0.5 text-[12.5px] text-[var(--ink3)]">Groups are labels you give contacts when you add or edit them.</p>
      {loading ? (
        <p className="mt-4 text-[13px] text-[var(--ink3)]" role="status">Loading…</p>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center py-10 text-center">
          <Tags className="h-9 w-9 text-[var(--ink3)]" aria-hidden />
          <p className="mt-3 text-[14px] font-semibold text-[var(--ink)]">No groups yet</p>
          <p className="mt-1 max-w-sm text-[12.5px] text-[var(--ink3)]">Add a group such as Colleagues or Clients when you create or edit a contact.</p>
          <button type="button" className="zoiko-btn pri mt-4" onClick={onNew}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> New Contact
          </button>
        </div>
      ) : (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <li key={g.name}>
              <Link
                href={`/mail/contacts?view=groups&group=${encodeURIComponent(g.name)}`}
                className="flex items-center gap-3 rounded-xl border border-[var(--border)] px-4 py-3 hover:bg-[var(--s2)]"
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-ink)]">
                  <Tags className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-[var(--ink)]">{g.name}</span>
                <span className="text-[12px] text-[var(--ink3)]">{g.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
