"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, FileText, Mail, StickyNote } from "lucide-react";
import { listMail, type MailListFolder } from "@/lib/mail-api";
import { useCalendarEvents } from "@/lib/calendar-hooks";
import type { EvidenceInput } from "@/lib/workgraph-api";
import { label } from "./shared";

/** A source chosen for evidence, with the name to show for it until the server names it. */
export interface PickedSource {
  input: EvidenceInput;
  name: string;
}

type Tab = "EMAIL" | "MEETING" | "DOCUMENT" | "NOTE";
const TABS: { key: Tab; text: string; icon: typeof Mail }[] = [
  { key: "EMAIL", text: "Email", icon: Mail },
  { key: "MEETING", text: "Meeting", icon: CalendarDays },
  { key: "DOCUMENT", text: "Document", icon: FileText },
  { key: "NOTE", text: "Note", icon: StickyNote },
];

const when = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

/**
 * Choose what evidences something: a message from your own mailbox, a meeting
 * you organise or are invited to, or a document or note you name. A message or
 * meeting is picked from a list so it is always a real one — the server checks
 * it again and names it from the source itself.
 */
export function SourcePicker({ onPick, chosen = [] }: { onPick: (source: PickedSource) => void; chosen?: PickedSource[] }) {
  const [tab, setTab] = useState<Tab>("EMAIL");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [folder, setFolder] = useState<MailListFolder>("INBOX");
  const [name, setName] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const mail = useQuery({
    queryKey: ["workgraph", "source-mail", folder, debounced],
    queryFn: () => listMail({ folder, q: debounced || undefined, limit: 8 }),
    enabled: tab === "EMAIL",
    staleTime: 30_000,
  });
  const range = useMemo(() => {
    const now = new Date();
    return { from: new Date(now.getTime() - 45 * 86_400_000), to: new Date(now.getTime() + 45 * 86_400_000) };
  }, []);
  const events = useCalendarEvents(range.from, range.to);
  const meetings = (events.data ?? []).filter((e) => !debounced || e.title.toLowerCase().includes(debounced.toLowerCase())).slice(0, 8);

  const has = (kind: Tab, refId: string) => chosen.some((c) => c.input.kind === kind && c.input.refId === refId);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--s2)] p-3" data-testid="source-picker">
      <div role="tablist" aria-label="Kind of source" className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] ${tab === t.key ? "bg-[var(--accent)] font-semibold text-white" : "text-[var(--ink2)] hover:bg-[var(--surface)]"}`}
          >
            <t.icon className="h-3.5 w-3.5" aria-hidden /> {t.text}
          </button>
        ))}
      </div>

      {(tab === "EMAIL" || tab === "MEETING") && (
        <>
          <div className="mb-2 flex gap-2">
            <input className="zoiko-input min-w-0 flex-1" placeholder={tab === "EMAIL" ? "Search your mail…" : "Search your meetings…"} aria-label="Search sources" value={q} onChange={(e) => setQ(e.target.value)} />
            {tab === "EMAIL" && (
              <select className="zoiko-input !w-[110px]" aria-label="Folder" value={folder} onChange={(e) => setFolder(e.target.value as MailListFolder)}>
                <option value="INBOX">Inbox</option>
                <option value="SENT">Sent</option>
                <option value="ARCHIVE">Archive</option>
              </select>
            )}
          </div>
          <ul className="max-h-48 space-y-1 overflow-y-auto" data-testid="source-results">
            {tab === "EMAIL" ? (
              mail.isLoading ? (
                <li className="p-2 text-[12px] text-[var(--ink3)]">Searching…</li>
              ) : (mail.data?.items ?? []).length === 0 ? (
                <li className="p-2 text-[12px] text-[var(--ink3)]">No messages found.</li>
              ) : (
                mail.data!.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={has("EMAIL", item.messageId)}
                      onClick={() => onPick({ input: { kind: "EMAIL", refId: item.messageId }, name: item.message.subject || "(no subject)" })}
                      className="flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] hover:bg-[var(--surface)] disabled:opacity-50"
                    >
                      <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ink3)]" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-[var(--ink)]">{item.message.subject || "(no subject)"}</span>
                        <span className="block truncate text-[11.5px] text-[var(--ink3)]">
                          {item.message.fromName || item.message.fromAddress || "Unknown sender"} · {when.format(new Date(item.message.sentAt ?? item.createdAt))}
                        </span>
                      </span>
                      <span className="text-[11.5px] text-[var(--accent-ink)]">{has("EMAIL", item.messageId) ? "Added" : "Add"}</span>
                    </button>
                  </li>
                ))
              )
            ) : events.isLoading ? (
              <li className="p-2 text-[12px] text-[var(--ink3)]">Loading…</li>
            ) : meetings.length === 0 ? (
              <li className="p-2 text-[12px] text-[var(--ink3)]">No meetings found in the last and next 45 days.</li>
            ) : (
              meetings.map((event) => (
                <li key={event.id}>
                  <button
                    type="button"
                    disabled={has("MEETING", event.id)}
                    onClick={() => onPick({ input: { kind: "MEETING", refId: event.id }, name: event.title })}
                    className="flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] hover:bg-[var(--surface)] disabled:opacity-50"
                  >
                    <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ink3)]" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-[var(--ink)]">{event.title}</span>
                      <span className="block text-[11.5px] text-[var(--ink3)]">{when.format(new Date(event.startsAt))}</span>
                    </span>
                    <span className="text-[11.5px] text-[var(--accent-ink)]">{has("MEETING", event.id) ? "Added" : "Add"}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </>
      )}

      {(tab === "DOCUMENT" || tab === "NOTE") && (
        <div>
          <label htmlFor="source-name" className={label}>
            {tab === "DOCUMENT" ? "Document name or reference" : "Note"}
          </label>
          <div className="flex gap-2">
            <input id="source-name" className="zoiko-input min-w-0 flex-1" placeholder={tab === "DOCUMENT" ? "e.g. Data policy review v3" : "e.g. Agreed on the call with the partner"} maxLength={300} value={name} onChange={(e) => setName(e.target.value)} />
            <button
              type="button"
              className="zoiko-btn"
              disabled={!name.trim()}
              onClick={() => {
                onPick({ input: { kind: tab, label: name.trim() }, name: name.trim() });
                setName("");
              }}
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
