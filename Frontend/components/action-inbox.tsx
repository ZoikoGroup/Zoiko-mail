"use client";

import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Inbox, CheckCircle2, XCircle, Clock, UserPlus, Search, ChevronDown,
  Sparkles, Mail, Link2, ShieldCheck, Bell, Calendar, MessageSquare,
  ArrowUpRight, CircleDot, Send, FileText, Settings, LayoutGrid, Quote,
} from "lucide-react";
import type { Commitment, CommitmentType, CommitmentStatus } from "@/lib/types";
import { fetchCommitments, generateDraft } from "@/lib/api";
import { useUiStore, type FilterKey } from "@/lib/store";

const TYPE_META: Record<CommitmentType, { label: string; icon: any; chip: string }> = {
  commitment:       { label: "Commitment", icon: CircleDot,     chip: "bg-teal-50 text-teal-700 ring-teal-600/20" },
  reply_owed:       { label: "Reply owed",  icon: MessageSquare, chip: "bg-sky-50 text-sky-700 ring-sky-600/20" },
  approval_request: { label: "Approval",    icon: ShieldCheck,   chip: "bg-violet-50 text-violet-700 ring-violet-600/20" },
  deadline:         { label: "Deadline",    icon: Calendar,      chip: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  follow_up:        { label: "Follow-up",   icon: ArrowUpRight,  chip: "bg-slate-100 text-slate-600 ring-slate-500/20" },
};

export function ActionInbox() {
  const qc = useQueryClient();
  const { activeTenantId, activeTenantName, selectedId, filter, setSelected, setFilter } = useUiStore();
  const [draftState, setDraftState] = useState<"idle" | "pending" | "ready">("idle");

  // --- SERVER STATE via TanStack Query ---
  const { data: items = [], isLoading, error } = useQuery({
    queryKey: ["commitments", activeTenantId],
    queryFn: () => fetchCommitments(activeTenantId),
  });

  // --- MUTATION with optimistic cache update (no backend persistence needed) ---
  const mutate = useMutation({
    mutationFn: async (v: { id: string; status: CommitmentStatus }) => {
      // Real app: PATCH /commitments/{id}/confirm etc. with an Idempotency-Key.
      return v;
    },
    onMutate: async ({ id, status }) => {
      const key = ["commitments", activeTenantId];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Commitment[]>(key);
      qc.setQueryData<Commitment[]>(key, (old) =>
        (old ?? []).map((c) => (c.id === id ? { ...c, status } : c))
      );
      return { prev, key };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
  });
  const setStatus = (id: string, status: CommitmentStatus) => mutate.mutate({ id, status });

  const draftMutation = useMutation({
    mutationFn: (id: string) => generateDraft(id),
    onMutate: () => setDraftState("pending"),
    onSuccess: () => setDraftState("ready"),
  });

  const filters: { key: FilterKey; label: string }[] = [
    { key: "needs_review", label: "Needs review" },
    { key: "all", label: "All" },
    { key: "commitment", label: "Commitments" },
    { key: "reply_owed", label: "Replies owed" },
    { key: "approval_request", label: "Approvals" },
    { key: "deadline", label: "Deadlines" },
  ];

  const visible = useMemo(
    () =>
      items.filter((i) => {
        if (i.status === "dismissed" || i.status === "completed") return false;
        if (filter === "needs_review") return i.status === "suggested";
        if (filter === "all") return true;
        return i.type === filter;
      }),
    [items, filter]
  );

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const needsReviewCount = items.filter((i) => i.status === "suggested").length;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50 font-sans text-slate-800">
      {/* Left rail */}
      <aside className="flex w-60 shrink-0 flex-col bg-slate-900 text-slate-300">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-teal-500 text-slate-900">
            <Mail className="h-4 w-4" />
          </div>
          <span className="font-serif text-lg font-semibold tracking-tight text-white">Zoiko Mail</span>
        </div>
        <nav className="mt-2 flex-1 space-y-0.5 px-3 text-sm">
          <NavItem icon={Inbox} label="Action Inbox" badge={needsReviewCount} active />
          <NavItem icon={LayoutGrid} label="Threads" />
          <NavItem icon={Bell} label="Daily digest" />
          <NavItem icon={Link2} label="Connected accounts" />
          <NavItem icon={FileText} label="Audit log" />
          <NavItem icon={Settings} label="Settings" />
        </nav>
        <div className="mx-3 mb-3 rounded-lg bg-slate-800/60 p-3 text-xs">
          <div className="mb-2 flex items-center gap-1.5 text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-teal-400" /> Connected
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-white text-[9px] font-bold text-slate-700">G</span>
            you@gmail.com
          </div>
        </div>
        <button className="flex items-center justify-between border-t border-slate-800 px-4 py-3 text-sm hover:bg-slate-800">
          <span className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded bg-teal-600 text-xs font-bold text-white">
              {activeTenantName[0]}
            </span>
            {activeTenantName}
          </span>
          <ChevronDown className="h-4 w-4 text-slate-500" />
        </button>
      </aside>

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
          <div className="flex flex-1 items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-500">
            <Search className="h-4 w-4" />
            <input className="w-full bg-transparent outline-none placeholder:text-slate-400" placeholder="Search actions, people, threads…" />
          </div>
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-white">YO</span>
        </header>

        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col border-r border-slate-200">
            <div className="px-6 pt-6">
              <h1 className="font-serif text-2xl font-semibold tracking-tight text-slate-900">Action Inbox</h1>
              <p className="mt-1 text-sm text-slate-500">
                AI-detected items from your connected mail. Nothing is tracked until you confirm it.
              </p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {filters.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`rounded-full px-3 py-1 text-sm transition ${
                      filter === f.key ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 flex-1 space-y-2 overflow-y-auto px-6 pb-6">
              {isLoading && <p className="mt-8 text-sm text-slate-400">Loading actions…</p>}
              {error && <p className="mt-8 text-sm text-rose-600">Couldn't load actions. Check the API route and try again.</p>}

              {!isLoading && visible.length === 0 && (
                <div className="mt-16 flex flex-col items-center text-center text-slate-400">
                  <CheckCircle2 className="h-10 w-10 text-teal-500" />
                  <p className="mt-3 text-sm font-medium text-slate-600">You're all caught up</p>
                  <p className="text-xs">New actions appear here as mail syncs.</p>
                </div>
              )}

              {visible.map((i) => {
                const overdue = i.due === "Today" || i.priority === "urgent";
                return (
                  <button
                    key={i.id}
                    onClick={() => { setSelected(i.id); setDraftState("idle"); }}
                    className={`block w-full rounded-lg border bg-white p-4 text-left transition hover:border-slate-300 hover:shadow-sm ${
                      selectedId === i.id ? "border-teal-500 ring-1 ring-teal-500/30" : "border-slate-200"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <TypeChip type={i.type} />
                      {i.status === "confirmed" && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-teal-700">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Confirmed
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm font-medium text-slate-900">{i.title}</p>
                    <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                      <Avatar name={i.owedTo.name} />
                      <span>to {i.owedTo.name}</span>
                      <span className="text-slate-300">·</span>
                      <span className={`inline-flex items-center gap-1 ${overdue ? "font-medium text-amber-600" : ""}`}>
                        <Clock className="h-3 w-3" /> {i.due}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <ConfidenceBar value={i.confidence} />
                      {i.status === "suggested" && (
                        <div className="flex items-center gap-1">
                          <span
                            onClick={(e) => { e.stopPropagation(); setStatus(i.id, "confirmed"); }}
                            className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-teal-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-700"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Confirm
                          </span>
                          <span
                            onClick={(e) => { e.stopPropagation(); setStatus(i.id, "dismissed"); }}
                            className="inline-flex cursor-pointer items-center rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                            title="Dismiss"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </span>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Detail drawer */}
          <aside className="hidden w-96 shrink-0 flex-col overflow-y-auto bg-white lg:flex">
            {!selected ? (
              <div className="m-auto text-sm text-slate-400">Select an action to see its source.</div>
            ) : (
              <div className="flex flex-col gap-5 p-6">
                <div>
                  <TypeChip type={selected.type} />
                  <h2 className="mt-3 font-serif text-lg font-semibold leading-snug text-slate-900">{selected.title}</h2>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Field label="Owed by"><span className="flex items-center gap-1.5"><Avatar name={selected.owedBy.name} />{selected.owedBy.name}</span></Field>
                  <Field label="Owed to"><span className="flex items-center gap-1.5"><Avatar name={selected.owedTo.name} />{selected.owedTo.name}</span></Field>
                  <Field label="Due"><span className="text-slate-700">{selected.due}</span></Field>
                  <Field label="Confidence"><ConfidenceBar value={selected.confidence} /></Field>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Source</span>
                    <button className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline">
                      Open thread <ArrowUpRight className="h-3 w-3" />
                    </button>
                  </div>
                  <p className="text-xs text-slate-500">{selected.thread} · from {selected.sender}</p>
                  <div className="mt-2 flex gap-2">
                    <Quote className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />
                    <p className="text-sm italic leading-relaxed text-slate-700">&ldquo;{selected.excerpt}&rdquo;</p>
                  </div>
                  <p className="mt-3 border-t border-slate-200 pt-2 text-xs text-slate-500">
                    <Sparkles className="mr-1 inline h-3 w-3 text-teal-500" />
                    Why flagged: {selected.rationale}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selected.status === "suggested" ? (
                    <>
                      <PrimaryBtn onClick={() => setStatus(selected.id, "confirmed")}><CheckCircle2 className="h-4 w-4" /> Confirm action</PrimaryBtn>
                      <GhostBtn onClick={() => setStatus(selected.id, "dismissed")}>Dismiss</GhostBtn>
                    </>
                  ) : (
                    <>
                      <GhostBtn onClick={() => setStatus(selected.id, "completed")}><CheckCircle2 className="h-4 w-4" /> Mark complete</GhostBtn>
                      <GhostBtn><UserPlus className="h-4 w-4" /> Assign</GhostBtn>
                      <GhostBtn><Clock className="h-4 w-4" /> Snooze</GhostBtn>
                    </>
                  )}
                </div>
                <div className="rounded-lg border border-slate-200 p-4">
                  <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700">
                    <Sparkles className="h-4 w-4 text-teal-600" /> AI draft reply
                  </div>
                  {draftState === "idle" && (
                    <button onClick={() => draftMutation.mutate(selected.id)} className="text-sm text-teal-700 hover:underline">
                      Generate a draft →
                    </button>
                  )}
                  {draftState === "pending" && <p className="animate-pulse text-sm text-slate-400">Generating draft…</p>}
                  {draftState === "ready" && (
                    <div className="space-y-3">
                      <div className="rounded-md bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">
                        Hi {selected.owedTo.name.split(" ")[0]}, thanks for the note — I&rsquo;ll have this to you by {selected.due}. Shout if anything changes before then.
                      </div>
                      <div className="flex items-center gap-2">
                        <PrimaryBtn><Send className="h-4 w-4" /> Review &amp; send</PrimaryBtn>
                        <span className="text-xs text-slate-400">AI-assisted · you send</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = value >= 0.8 ? "bg-teal-600" : value >= 0.65 ? "bg-amber-500" : "bg-slate-400";
  const label = value >= 0.8 ? "High" : value >= 0.65 ? "Medium" : "Low";
  return (
    <div className="flex items-center gap-2" title={`Model confidence ${pct}%`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs text-slate-500">{label} · {pct}%</span>
    </div>
  );
}

function TypeChip({ type }: { type: CommitmentType }) {
  const m = TYPE_META[type];
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${m.chip}`}>
      <Icon className="h-3 w-3" /> {m.label}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-600">
      {initials}
    </span>
  );
}

function NavItem({ icon: Icon, label, badge, active }: { icon: any; label: string; badge?: number; active?: boolean }) {
  return (
    <a className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition ${active ? "bg-slate-800 text-white" : "hover:bg-slate-800/50 hover:text-white"}`}>
      <Icon className="h-4 w-4" />
      <span className="flex-1">{label}</span>
      {badge ? <span className="rounded-full bg-teal-500 px-1.5 py-0.5 text-[10px] font-semibold text-slate-900">{badge}</span> : null}
    </a>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function PrimaryBtn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-teal-700">
      {children}
    </button>
  );
}

function GhostBtn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-100">
      {children}
    </button>
  );
}
