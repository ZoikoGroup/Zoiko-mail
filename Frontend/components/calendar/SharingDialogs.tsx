"use client";

import { useState } from "react";
import { Check, ShieldCheck, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { CALENDAR_COLORS, type AccessibleCalendar, type CalendarAccess, type CalendarColor } from "@/lib/calendar-api";
import {
  useCreateTeamCalendar,
  useRemoveShare,
  useRequestAccess,
  useShareCalendar,
  useShares,
} from "@/lib/calendar-hooks";
import { ApiError } from "@/lib/api-client";
import { AttendeeInput, initials } from "./AttendeeInput";
import { ACCESS_LABEL, ACCESS_OPTIONS } from "./access";
import { COLOR_NAME, swatchStyle } from "./palette";

const label = "mb-1 block text-[12px] font-medium text-[var(--ink2)]";

function AccessSelect({ value, onChange, id }: { value: CalendarAccess; onChange: (v: CalendarAccess) => void; id: string }) {
  return (
    <select id={id} className="zoiko-input w-full" value={value} onChange={(e) => onChange(e.target.value as CalendarAccess)}>
      {ACCESS_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label} — {o.hint}
        </option>
      ))}
    </select>
  );
}

/** A shared calendar for a group: its members see it and add events. */
export function TeamCalendarDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<CalendarColor>("purple");
  const [members, setMembers] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const create = useCreateTeamCalendar();
  const problem = name.trim() ? null : "Give the team calendar a name.";
  const save = () => {
    setTouched(true);
    if (problem || create.isPending) return;
    create.mutate({ name: name.trim(), color, members }, { onSuccess: onClose });
  };
  return (
    <Modal
      open
      onClose={create.isPending ? () => undefined : onClose}
      title="New team calendar"
      footer={
        <>
          <button type="button" className="zoiko-btn" onClick={onClose} disabled={create.isPending}>
            Cancel
          </button>
          <button type="button" className="zoiko-btn pri" onClick={save} disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create team calendar"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor="tc-name" className={label}>
            Name
          </label>
          <input id="tc-name" className="zoiko-input w-full" autoFocus placeholder="e.g. Product & Engineering" value={name} onChange={(e) => setName(e.target.value)} />
          {touched && problem && <p className="mt-1 text-[11.5px] text-[var(--crit)]">{problem}</p>}
        </div>
        <fieldset>
          <legend className="mb-2 text-[12px] font-medium text-[var(--ink2)]">Colour</legend>
          <div className="flex flex-wrap gap-2">
            {CALENDAR_COLORS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setColor(key)}
                aria-label={COLOR_NAME[key]}
                aria-pressed={color === key}
                className={`flex h-8 w-8 items-center justify-center rounded-full ring-offset-2 ring-offset-[var(--surface)] ${color === key ? "ring-2 ring-[var(--ink)]" : ""}`}
                style={swatchStyle(key)}
              >
                {color === key && <Check className="h-4 w-4 text-white" strokeWidth={3} aria-hidden />}
              </button>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="tc-members" className={label}>
            Members
          </label>
          <AttendeeInput inputId="tc-members" value={members} onChange={setMembers} />
          <p className="mt-1 text-[11.5px] text-[var(--ink3)]">Members see this calendar and can add and change its events. You manage it.</p>
        </div>
        {create.error && (
          <p role="alert" className="text-[12px] text-[var(--crit)]">
            {(create.error as Error).message}
          </p>
        )}
      </div>
    </Modal>
  );
}

/**
 * Who can see a calendar and how. Its owner or a manager adds people and
 * changes or removes their access; anyone else sees the list and can leave.
 */
export function AccessDialog({ calendar, onClose }: { calendar: AccessibleCalendar; onClose: () => void }) {
  const shares = useShares(calendar.id);
  const share = useShareCalendar();
  const remove = useRemoveShare();
  const [people, setPeople] = useState<string[]>([]);
  const [access, setAccess] = useState<CalendarAccess>(calendar.kind === "TEAM" ? "EDIT" : "VIEW");
  const canManage = calendar.access === "OWNER" || calendar.access === "MANAGE";
  const busy = share.isPending || remove.isPending;
  const error = (share.error ?? remove.error ?? shares.error) as Error | null;

  const addAll = async () => {
    for (const email of people) {
      await share.mutateAsync({ calendarId: calendar.id, email, access });
    }
    setPeople([]);
  };

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title={`Access to ${calendar.name}`}
      size="lg"
      footer={
        <button type="button" className="zoiko-btn pri" onClick={onClose} disabled={busy}>
          Done
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        {canManage && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--s2)] p-3">
            <p className="mb-2 text-[12.5px] font-semibold text-[var(--ink)]">Share with colleagues</p>
            <AttendeeInput inputId="share-people" value={people} onChange={setPeople} />
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div className="min-w-[220px] flex-1">
                <label htmlFor="share-access" className={label}>
                  They can
                </label>
                <AccessSelect id="share-access" value={access} onChange={setAccess} />
              </div>
              <button type="button" className="zoiko-btn pri" disabled={busy || people.length === 0} onClick={() => void addAll().catch(() => undefined)}>
                {share.isPending ? "Sharing…" : "Share"}
              </button>
            </div>
          </div>
        )}

        {shares.isLoading ? (
          <p className="text-[12.5px] text-[var(--ink3)]">Loading…</p>
        ) : shares.error instanceof ApiError && shares.error.status === 403 ? (
          <p className="text-[12.5px] text-[var(--ink3)]">With free/busy access you see only when it is busy, not who else can see it.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]" data-testid="share-list">
            {shares.data?.owner && (
              <li className="flex items-center gap-3 py-2.5">
                <Avatar name={shares.data.owner.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-[var(--ink)]">{shares.data.owner.name}</span>
                  <span className="block truncate text-[11.5px] text-[var(--ink3)]">{shares.data.owner.email}</span>
                </span>
                <span className="text-[12px] text-[var(--ink2)]">Owner</span>
              </li>
            )}
            {shares.data?.shares.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <Avatar name={s.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-[var(--ink)]">
                    {s.name}
                    {s.isMe ? " (you)" : ""}
                  </span>
                  <span className="block truncate text-[11.5px] text-[var(--ink3)]">{s.email}</span>
                </span>
                {canManage ? (
                  <select
                    className="zoiko-input w-[150px] py-1 text-[12px]"
                    value={s.access}
                    aria-label={`Access for ${s.name}`}
                    disabled={busy}
                    onChange={(e) => share.mutate({ calendarId: calendar.id, email: s.email, access: e.target.value as CalendarAccess })}
                  >
                    {ACCESS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-[12px] text-[var(--ink2)]">{ACCESS_LABEL[s.access]}</span>
                )}
                {(canManage || s.isMe) && (
                  <button
                    type="button"
                    className="rounded p-1 text-[var(--ink3)] hover:bg-[var(--s2)] hover:text-[var(--crit)]"
                    aria-label={s.isMe ? `Leave ${calendar.name}` : `Remove ${s.name}`}
                    title={s.isMe ? "Leave" : "Remove"}
                    disabled={busy}
                    onClick={() =>
                      remove.mutate(
                        { calendarId: calendar.id, shareId: s.id },
                        { onSuccess: () => (s.isMe ? onClose() : undefined) }
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </li>
            ))}
            {shares.data && shares.data.shares.length === 0 && (
              <li className="py-2.5 text-[12.5px] text-[var(--ink3)]">Not shared with anyone yet.</li>
            )}
          </ul>
        )}
        <p className="flex items-center gap-1.5 text-[11.5px] text-[var(--ink3)]">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Private events always show to others as Busy. External sharing is off.
        </p>
        {error && !(error instanceof ApiError && error.status === 403) && (
          <p role="alert" className="text-[12px] text-[var(--crit)]">
            {error.message}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** Ask a colleague for access to their calendar, or for more access to one already shared. */
export function RequestAccessDialog({
  calendar,
  onClose,
}: {
  /** When set, ask for more access to this calendar; otherwise choose a colleague. */
  calendar?: AccessibleCalendar | null;
  onClose: () => void;
}) {
  const [people, setPeople] = useState<string[]>([]);
  const [access, setAccess] = useState<CalendarAccess>(calendar ? "EDIT" : "VIEW");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const request = useRequestAccess();
  const problem = !calendar && people.length !== 1 ? "Choose one colleague." : null;

  const send = () => {
    if (problem || request.isPending) return;
    request.mutate(
      {
        ...(calendar ? { calendarId: calendar.id } : { ownerEmail: people[0]! }),
        access,
        message: message.trim() || undefined,
      },
      { onSuccess: () => setSent(true) }
    );
  };

  return (
    <Modal
      open
      onClose={request.isPending ? () => undefined : onClose}
      title={calendar ? `Request more access to ${calendar.name}` : "Request access to a calendar"}
      size="sm"
      footer={
        sent ? (
          <button type="button" className="zoiko-btn pri" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="zoiko-btn" onClick={onClose} disabled={request.isPending}>
              Cancel
            </button>
            <button type="button" className="zoiko-btn pri" onClick={send} disabled={request.isPending || Boolean(problem)}>
              {request.isPending ? "Sending…" : "Send request"}
            </button>
          </>
        )
      }
    >
      {sent ? (
        <p className="flex items-start gap-2 text-[13px] text-[var(--ink2)]" role="status">
          <Check className="mt-0.5 h-4 w-4 text-[#22B07D]" aria-hidden /> Request sent. You will be notified when it is approved or declined.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {!calendar && (
            <div>
              <label htmlFor="ra-person" className={label}>
                Whose calendar
              </label>
              <AttendeeInput inputId="ra-person" value={people} onChange={(next) => setPeople(next.slice(-1))} />
            </div>
          )}
          <div>
            <label htmlFor="ra-access" className={label}>
              Access you need
            </label>
            <AccessSelect id="ra-access" value={access} onChange={setAccess} />
          </div>
          <div>
            <label htmlFor="ra-message" className={label}>
              Why (optional)
            </label>
            <textarea id="ra-message" className="zoiko-input min-h-[64px] w-full" maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          {request.error && (
            <p role="alert" className="text-[12px] text-[var(--crit)]">
              {(request.error as Error).message}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Pick one of my calendars, then manage who it is shared with. */
export function ShareCalendarDialog({ calendars, onClose }: { calendars: AccessibleCalendar[]; onClose: () => void }) {
  const mine = calendars.filter((c) => c.access === "OWNER" || c.access === "MANAGE");
  const [chosen, setChosen] = useState<AccessibleCalendar | null>(mine.length === 1 ? mine[0]! : null);
  if (chosen) return <AccessDialog calendar={chosen} onClose={onClose} />;
  return (
    <Modal open onClose={onClose} title="Share a calendar" size="sm">
      {mine.length === 0 ? (
        <p className="text-[13px] text-[var(--ink3)]">You have no calendars you can share yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {mine.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setChosen(c)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] text-[var(--ink)] hover:bg-[var(--s2)]">
                <span className="h-3 w-3 rounded-full" style={swatchStyle(c.color)} aria-hidden />
                <span className="flex-1 truncate">{c.name}</span>
                <span className="text-[11.5px] text-[var(--ink3)]">
                  {c.kind === "TEAM" ? "Team" : "Personal"} · shared with {c.sharedWithCount}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-7 w-7 text-[10.5px]" : "h-8 w-8 text-[11px]";
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full bg-[var(--accent)] font-semibold text-white ${box}`} aria-hidden>
      {initials(name)}
    </span>
  );
}
