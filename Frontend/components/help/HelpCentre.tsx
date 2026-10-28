"use client";

import { useMemo, useState } from "react";
import { ChevronDown, LifeBuoy, Search, Send } from "lucide-react";
import { WebmailShell } from "@/components/mail/WebmailShell";
import { ApiError } from "@/lib/api-client";
import { HELP_CATEGORIES, searchArticles } from "@/lib/help-content";
import { useCreateRequest, useMyRequests, useReplyToRequest, useRequest } from "@/lib/help-hooks";
import type { SupportTicket, TicketCategory, TicketSeverity, TicketStatus } from "@/lib/support-api";

const REQUEST_CATEGORIES: Array<{ value: TicketCategory; label: string }> = [
  { value: "DELIVERY", label: "Sending or receiving mail" },
  { value: "ACCOUNT", label: "My account or sign-in" },
  { value: "SECURITY", label: "Security" },
  { value: "DOMAIN", label: "Domain or addresses" },
  { value: "BILLING", label: "Billing" },
  { value: "OTHER", label: "Something else" },
];

const URGENCY: Array<{ value: TicketSeverity; label: string }> = [
  { value: "LOW", label: "Low — a question" },
  { value: "MEDIUM", label: "Normal" },
  { value: "HIGH", label: "High — I can’t work" },
];

const STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  WAITING_TENANT: "Waiting for you",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

function message(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "Something went wrong";
}

const fieldClass =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30";

/** /mail/help — guides, and a way to reach the support team. */
export function HelpCentre() {
  return (
    <WebmailShell section="help">
      <HelpBody />
    </WebmailShell>
  );
}

function HelpBody() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const articles = useMemo(() => searchArticles(query, category), [query, category]);

  return (
    <div className="h-full overflow-y-auto bg-[var(--ground)]" data-testid="help-centre">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 sm:p-6">
        <header>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-[var(--ink)]">
            <LifeBuoy className="h-5 w-5 text-[var(--accent)]" aria-hidden /> Help centre
          </h1>
          <p className="mt-1 text-sm text-[var(--ink3)]">Guides for Zoiko Mail, and a way to reach us when they don’t answer it.</p>
        </header>

        <section aria-label="Guides" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <label className="relative block">
            <span className="sr-only">Search the guides</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink3)]" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the guides — try “attachment” or “snooze”"
              className={`${fieldClass} pl-9`}
            />
          </label>

          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Topics">
            {[{ key: null, label: "All" }, ...HELP_CATEGORIES].map((item) => {
              const current = category === item.key;
              return (
                <button
                  key={item.key ?? "all"}
                  type="button"
                  aria-pressed={current}
                  onClick={() => setCategory(item.key)}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    current
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] font-medium text-[var(--ink)]"
                      : "border-[var(--border)] text-[var(--ink3)] hover:text-[var(--ink)]"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          {articles.length === 0 ? (
            <p className="mt-5 text-sm text-[var(--ink3)]" data-testid="help-empty">
              No guide matches “{query}”. Try a different word, or send us a request below.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--border)]" data-testid="help-articles">
              {articles.map((article) => {
                const open = openId === article.id;
                const topic = HELP_CATEGORIES.find((item) => item.key === article.category)?.label;
                return (
                  <li key={article.id}>
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={`help-${article.id}`}
                      onClick={() => setOpenId(open ? null : article.id)}
                      className="flex w-full items-center gap-3 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-[var(--ink)]">{article.title}</span>
                        <span className="block text-xs text-[var(--ink3)]">{topic}</span>
                      </span>
                      <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--ink3)] transition ${open ? "rotate-180" : ""}`} aria-hidden />
                    </button>
                    {open && (
                      <div id={`help-${article.id}`} className="space-y-2 pb-4 pr-7 text-sm leading-relaxed text-[var(--ink2)]">
                        {article.body.map((line) =>
                          line.startsWith("• ") ? (
                            <p key={line} className="pl-4 -indent-3">
                              • {line.slice(2)}
                            </p>
                          ) : (
                            <p key={line}>{line}</p>
                          ),
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <ContactSupport />
        <MyRequests />
      </div>
    </div>
  );
}

function ContactSupport() {
  const create = useCreateRequest();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<TicketCategory>("OTHER");
  const [severity, setSeverity] = useState<TicketSeverity>("MEDIUM");
  const [sent, setSent] = useState<SupportTicket | null>(null);

  const ready = subject.trim().length >= 3 && description.trim().length >= 10;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || create.isPending) return;
    create.mutate(
      { subject: subject.trim(), description: description.trim(), category, severity },
      {
        onSuccess: (ticket) => {
          setSent(ticket);
          setSubject("");
          setDescription("");
          setCategory("OTHER");
          setSeverity("MEDIUM");
        },
      },
    );
  }

  return (
    <section aria-label="Contact support" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-sm font-semibold text-[var(--ink)]">Contact support</h2>
      <p className="mt-1 text-sm text-[var(--ink3)]">Tell us what’s wrong and we’ll reply here. Include addresses and times if mail is going missing.</p>

      {sent && (
        <p role="status" className="mt-3 rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-sm text-[var(--ink)]" data-testid="request-sent">
          Request #{sent.ticketNumber} sent. {sent.slaTarget ? `We aim to reply within ${sent.slaTarget}.` : "We’ll reply here."}
        </p>
      )}

      <form onSubmit={submit} className="mt-4 grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--ink2)]">What is it about?</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)} className={fieldClass}>
              {REQUEST_CATEGORIES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--ink2)]">How urgent is it?</span>
            <select value={severity} onChange={(e) => setSeverity(e.target.value as TicketSeverity)} className={fieldClass}>
              {URGENCY.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--ink2)]">Subject</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} className={fieldClass} placeholder="A short summary" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--ink2)]">Details</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={5000}
            rows={5}
            className={fieldClass}
            placeholder="What happened, and what did you expect? (at least 10 characters)"
          />
        </label>
        {create.isError && (
          <p role="alert" className="text-sm text-[var(--crit)]">
            Couldn’t send your request. {message(create.error)}
          </p>
        )}
        <div>
          <button type="submit" disabled={!ready || create.isPending} className="zoiko-btn zoiko-btn-primary inline-flex items-center gap-1.5">
            <Send className="h-4 w-4" aria-hidden /> {create.isPending ? "Sending…" : "Send request"}
          </button>
        </div>
      </form>
    </section>
  );
}

function MyRequests() {
  const { data, isLoading, isError, error } = useMyRequests();
  const [openId, setOpenId] = useState<string | null>(null);
  const tickets = data?.tickets ?? [];

  return (
    <section aria-label="Your requests" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-sm font-semibold text-[var(--ink)]">Your requests</h2>
      {isLoading ? (
        <div className="mt-3 h-16 animate-pulse rounded-lg bg-[var(--s2)]" aria-busy="true" />
      ) : isError ? (
        <p role="alert" className="mt-3 text-sm text-[var(--crit)]">
          Couldn’t load your requests. {message(error)}
        </p>
      ) : tickets.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--ink3)]">You haven’t sent us anything yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--border)]" data-testid="my-requests">
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <button
                type="button"
                aria-expanded={openId === ticket.id}
                onClick={() => setOpenId(openId === ticket.id ? null : ticket.id)}
                className="flex w-full items-center gap-3 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[var(--ink)]">
                    #{ticket.ticketNumber} · {ticket.subject}
                  </span>
                  <span className="block text-xs text-[var(--ink3)]">Sent {new Date(ticket.createdAt).toLocaleDateString()}</span>
                </span>
                <span className="shrink-0 rounded-full bg-[var(--s2)] px-2.5 py-0.5 text-xs text-[var(--ink2)]">{STATUS_LABEL[ticket.status]}</span>
              </button>
              {openId === ticket.id && <RequestThread ticketId={ticket.id} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RequestThread({ ticketId }: { ticketId: string }) {
  const { data: ticket, isLoading, isError, error } = useRequest(ticketId);
  const reply = useReplyToRequest(ticketId);
  const [body, setBody] = useState("");

  if (isLoading) return <div className="mb-3 h-12 animate-pulse rounded-lg bg-[var(--s2)]" aria-busy="true" />;
  if (isError || !ticket) {
    return (
      <p role="alert" className="mb-3 text-sm text-[var(--crit)]">
        Couldn’t open this request. {message(error)}
      </p>
    );
  }

  // Staff notes marked internal are never sent to a workspace member, but a
  // filter here keeps one from showing even if that ever changed.
  const comments = ticket.comments.filter((comment) => !comment.internal);
  const closed = ticket.status === "CLOSED";

  return (
    <div className="mb-4 space-y-3 rounded-xl bg-[var(--s2)] p-4 text-sm">
      <p className="whitespace-pre-wrap text-[var(--ink2)]">{ticket.description}</p>
      {comments.map((comment) => (
        <div key={comment.id} className="border-t border-[var(--border)] pt-3">
          <p className="text-xs text-[var(--ink3)]">
            {comment.authorType === "STAFF" ? "Support" : comment.author?.displayName ?? "You"} · {new Date(comment.createdAt).toLocaleString()}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[var(--ink)]">{comment.body}</p>
        </div>
      ))}
      {closed ? (
        <p className="border-t border-[var(--border)] pt-3 text-xs text-[var(--ink3)]">This request is closed. Send a new one if you still need help.</p>
      ) : (
        <form
          className="border-t border-[var(--border)] pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!body.trim() || reply.isPending) return;
            reply.mutate(body.trim(), { onSuccess: () => setBody("") });
          }}
        >
          <label className="block">
            <span className="sr-only">Reply</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000} className={fieldClass} placeholder="Add a reply" />
          </label>
          {reply.isError && (
            <p role="alert" className="mt-2 text-sm text-[var(--crit)]">
              Couldn’t send your reply. {message(reply.error)}
            </p>
          )}
          <button type="submit" disabled={!body.trim() || reply.isPending} className="zoiko-btn mt-2">
            {reply.isPending ? "Sending…" : "Reply"}
          </button>
        </form>
      )}
    </div>
  );
}
