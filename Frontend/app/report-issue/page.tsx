"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { isLoggedIn } from "@/lib/auth-storage";
import {
  commentTenantTicket,
  createTenantTicket,
  getTenantTicket,
  listTenantTickets,
  type CreateTicketInput,
  type TicketCategory,
  type TicketSeverity,
  type TicketStatus,
} from "@/lib/support-api";
import { ApiError } from "@/lib/api-client";
import { ShieldQuestion, ArrowLeft, Plus } from "lucide-react";

const CATEGORIES: TicketCategory[] = ["DELIVERY", "DOMAIN", "BILLING", "ACCOUNT", "SECURITY", "OTHER"];
const SEVERITIES: TicketSeverity[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

const STATUS_TONE: Record<string, string> = {
  OPEN: "nu",
  IN_PROGRESS: "accent",
  WAITING_TENANT: "warn",
  RESOLVED: "ok",
  CLOSED: "nu",
};

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : "Something went wrong";
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function ReportIssuePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Help & support | Zoiko Mail";
    if (!isLoggedIn()) router.replace("/login");
  }, [router]);

  const list = useQuery({
    queryKey: ["tenant-tickets"],
    queryFn: () => listTenantTickets(),
    retry: false,
  });

  const create = useMutation({
    mutationFn: (input: CreateTicketInput) => createTenantTicket(input),
    onSuccess: () => {
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ["tenant-tickets"] });
    },
  });

  return (
    <div className="min-h-screen bg-[var(--ground)] text-[var(--ink)]">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4 sm:px-6">
          <Link href="/account" className="inline-flex items-center gap-1.5 text-sm text-[var(--ink2)] hover:text-[var(--ink)]">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <span className="font-mono-num ml-1 text-[10px] uppercase tracking-[0.11em] text-[var(--ink3)]">Help &amp; support</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-editorial text-2xl font-normal tracking-tight text-[var(--ink)] sm:text-3xl">Support tickets</h1>
            <p className="mt-1 max-w-xl text-sm text-[var(--ink3)]">
              Report a problem to the Zoiko support team and track the conversation in one place.
            </p>
          </div>
          <button
            className="zoiko-btn pri shrink-0"
            onClick={() => setShowForm((v) => !v)}
          >
            <Plus className="h-4 w-4" />
            New ticket
          </button>
        </div>

        {showForm && (
          <NewTicketForm
            submitting={create.isPending}
            error={create.isError ? errMsg(create.error) : null}
            onCancel={() => setShowForm(false)}
            onSubmit={(input) => create.mutate(input)}
          />
        )}

        <div className="mt-8">
          <h2 className="font-mono-num text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">Your tickets</h2>

          {list.isError && (
            <div className="mt-3 rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] p-4 text-sm text-[var(--crit)]">
              {errMsg(list.error)}
            </div>
          )}

          {list.isLoading && (
            <div className="mt-6 flex h-24 items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
            </div>
          )}

          {list.data && list.data.tickets.length === 0 && (
            <div className="zoiko-card mt-3 flex flex-col items-center px-6 py-10 text-center">
              <ShieldQuestion className="h-8 w-8 text-[var(--ink3)]" />
              <p className="mt-3 text-sm font-medium text-[var(--ink2)]">No tickets yet</p>
              <p className="mt-1 max-w-sm text-xs text-[var(--ink3)]">
                If something is not working, open a ticket and the support team will follow up here.
              </p>
            </div>
          )}

          {list.data && list.data.tickets.length > 0 && (
            <div className="mt-3 divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              {list.data.tickets.map((t) => (
                <div key={t.id}>
                  <button
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--s2)]"
                    onClick={() => setOpenId(openId === t.id ? null : t.id)}
                  >
                    <span className="font-mono-num text-xs text-[var(--ink3)]">TKT-{String(t.ticketNumber).padStart(4, "0")}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--ink)]">{t.subject}</span>
                      <span className="block text-xs text-[var(--ink3)]">
                        {t.category} · opened {fmt(t.createdAt)}
                      </span>
                    </span>
                    <span className={`zoiko-pill ${STATUS_TONE[t.status] ?? "nu"}`}>{t.status.replace("_", " ")}</span>
                  </button>
                  {openId === t.id && <TicketThread ticketId={t.id} />}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function NewTicketForm({
  submitting,
  error,
  onCancel,
  onSubmit,
}: {
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (input: CreateTicketInput) => void;
}) {
  const [form, setForm] = useState<CreateTicketInput>({ subject: "", description: "", category: "OTHER", severity: "MEDIUM" });
  const valid = form.subject.trim().length >= 3 && form.description.trim().length >= 10;

  return (
    <div className="zoiko-card mt-6 p-6">
      <h2 className="text-sm font-semibold text-[var(--ink)]">Open a ticket</h2>
      {error && (
        <div className="mt-3 rounded-lg border border-[var(--crit)]/30 bg-[var(--crit-soft)] p-3 text-xs text-[var(--crit)]">{error}</div>
      )}
      <div className="mt-4 space-y-4">
        <Field label="Subject">
          <input
            className="zoiko-input"
            value={form.subject}
            maxLength={200}
            placeholder="Short summary of the problem"
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
          />
        </Field>
        <Field label="Description">
          <textarea
            className="zoiko-input min-h-[120px] resize-y"
            value={form.description}
            maxLength={5000}
            placeholder="What happened, and what did you expect?"
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Category">
            <select className="zoiko-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as TicketCategory })}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Severity">
            <select className="zoiko-input" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as TicketSeverity })}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="zoiko-btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="zoiko-btn pri" disabled={!valid || submitting} onClick={() => onSubmit(form)}>
          {submitting ? "Opening…" : "Open ticket"}
        </button>
      </div>
    </div>
  );
}

function TicketThread({ ticketId }: { ticketId: string }) {
  const qc = useQueryClient();
  const [reply, setReply] = useState("");
  const detail = useQuery({
    queryKey: ["tenant-ticket", ticketId],
    queryFn: () => getTenantTicket(ticketId),
    retry: false,
  });
  const comment = useMutation({
    mutationFn: (body: string) => commentTenantTicket(ticketId, body),
    onSuccess: () => {
      setReply("");
      qc.invalidateQueries({ queryKey: ["tenant-ticket", ticketId] });
      qc.invalidateQueries({ queryKey: ["tenant-tickets"] });
    },
  });

  if (detail.isLoading) {
    return <div className="px-4 py-4 text-xs text-[var(--ink3)]">Loading conversation…</div>;
  }
  if (detail.isError || !detail.data) {
    return <div className="px-4 py-4 text-xs text-[var(--crit)]">{errMsg(detail.error)}</div>;
  }

  const t = detail.data;
  const closed = t.status === "CLOSED";

  return (
    <div className="border-t border-[var(--border)] bg-[var(--s2)] px-4 py-4">
      <div className="space-y-3">
        <Bubble author={t.openedBy?.displayName ?? "You"} createdAt={t.createdAt} body={t.description} mine />
        {t.comments.map((c) => (
          <Bubble
            key={c.id}
            author={c.author?.displayName ?? c.authorType}
            createdAt={c.createdAt}
            body={c.body}
            mine={c.authorType === "TENANT"}
            badge={c.authorType === "STAFF" ? "Support" : undefined}
          />
        ))}
      </div>

      {closed ? (
        <p className="mt-4 text-xs text-[var(--ink3)]">This ticket is closed. Open a new ticket if the issue returns.</p>
      ) : (
        <div className="mt-4">
          <textarea
            className="zoiko-input min-h-[76px] resize-y"
            placeholder="Write a reply…"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
          {comment.isError && <p className="mt-1 text-xs text-[var(--crit)]">{errMsg(comment.error)}</p>}
          <div className="mt-2 flex justify-end">
            <button className="zoiko-btn pri" disabled={reply.trim().length === 0 || comment.isPending} onClick={() => comment.mutate(reply.trim())}>
              {comment.isPending ? "Sending…" : "Send reply"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Bubble({
  author,
  createdAt,
  body,
  mine,
  badge,
}: {
  author: string;
  createdAt: string;
  body: string;
  mine?: boolean;
  badge?: string;
}) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--s3)] text-[11px] font-semibold text-[var(--ink2)]">
        {author.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[var(--ink)]">{author}</span>
          <span className="text-[10px] text-[var(--ink3)]">{fmt(createdAt)}</span>
          {badge && <span className="zoiko-pill accent">{badge}</span>}
        </div>
        <div className={`mt-1 whitespace-pre-wrap rounded-lg border p-3 text-sm ${mine ? "border-[var(--border)] bg-[var(--surface)]" : "border-[var(--accent)]/20 bg-[var(--accent-soft)]"} text-[var(--ink2)]`}>
          {body}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--ink3)]">{label}</span>
      {children}
    </label>
  );
}