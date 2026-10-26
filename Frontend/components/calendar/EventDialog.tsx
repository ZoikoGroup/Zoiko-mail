"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, LayoutTemplate, Lock, MapPin, Video, AlignLeft, Trash2, Users } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { freeBusy, type Calendar, type CalendarEvent, type EventInput, type MeetingTemplate } from "@/lib/calendar-api";

/** What the dialog needs to know about a calendar it can save to. */
export type WritableCalendar = Pick<Calendar, "id" | "name" | "color" | "isDefault">;
import { useCreateEvent, useDeleteEvent, useOwnEvent, usePrefs, useTemplates, useUpdateEvent } from "@/lib/calendar-hooks";
import {
  addDays,
  allDayToUtc,
  fromInputs,
  localZone,
  preferredZone,
  toDateInput,
  toTimeInput,
  utcToAllDayLocal,
} from "@/lib/calendar-dates";
import { swatchStyle } from "./palette";
import { AttendeeInput } from "./AttendeeInput";

const label = "mb-1 block text-[12px] font-medium text-[var(--ink2)]";
const problemText = "mt-1 text-[11.5px] text-[var(--crit)]";

export interface EventDraftSeed {
  start: Date;
  end: Date;
  allDay?: boolean;
  /** Preselect this calendar (e.g. a team calendar on the Team page). */
  calendarId?: string;
  /** Prefill who is invited (e.g. from Find a time). */
  attendees?: string[];
  /** Start from this meeting template (Meeting Templates → Use template). */
  templateId?: string;
  /** Prefill the title (e.g. a follow-up planned from a commitment). */
  title?: string;
}

/**
 * Create or edit an event. `event` edits an existing one; otherwise `seed`
 * (the slot that was clicked, or the next half hour) prefills the times.
 */
export function EventDialog({
  calendars,
  event,
  seed,
  onClose,
}: {
  calendars: WritableCalendar[];
  event?: CalendarEvent | null;
  seed?: EventDraftSeed;
  onClose: () => void;
}) {
  // New events start from the member's Calendar Settings (length, privacy, busy/free).
  const prefs = usePrefs();
  const initial = useMemo(() => {
    if (event) {
      const start = event.allDay ? utcToAllDayLocal(event.startsAt) : new Date(event.startsAt);
      // All-day end is exclusive (midnight after the last day); show the last day.
      const end = event.allDay ? addDays(utcToAllDayLocal(event.endsAt), -1) : new Date(event.endsAt);
      return { start, end, allDay: event.allDay };
    }
    const start = seed?.start ?? nextHalfHour();
    const end = seed?.end ?? new Date(start.getTime() + prefs.defaultDurationMinutes * 60_000);
    return { start, end, allDay: seed?.allDay ?? false };
  }, [event, seed, prefs.defaultDurationMinutes]);

  const defaultCalendar = calendars.find((c) => c.id === seed?.calendarId) ?? calendars.find((c) => c.isDefault) ?? calendars[0];
  const [title, setTitle] = useState(event?.title ?? seed?.title ?? "");
  const [calendarId, setCalendarId] = useState(event?.calendarId ?? defaultCalendar?.id ?? "");
  const [allDay, setAllDay] = useState(initial.allDay);
  const [startDate, setStartDate] = useState(toDateInput(initial.start));
  const [startTime, setStartTime] = useState(toTimeInput(initial.start));
  const [endDate, setEndDate] = useState(toDateInput(initial.end));
  const [endTime, setEndTime] = useState(toTimeInput(initial.end));
  const [location, setLocation] = useState(event?.location ?? "");
  const [videoLink, setVideoLink] = useState(event?.videoLink ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [isPrivate, setIsPrivate] = useState(event ? event.visibility === "PRIVATE" : prefs.defaultVisibility === "PRIVATE");
  const [showAs, setShowAs] = useState<"BUSY" | "FREE">(event?.showAs ?? prefs.defaultShowAs);
  const [touched, setTouched] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [attendees, setAttendees] = useState<string[]>(seed?.attendees ?? []);
  const [attendeesTouched, setAttendeesTouched] = useState(false);

  // Meeting templates (new events only): fill in the defaults, then keep its
  // safeguards — no clash with my calendar (buffer included), enough notice,
  // and outside guests only where the template allows them.
  // Templates are optional here: if they cannot be loaded, the dialog works without them.
  const templates = useTemplates();
  const templateList = useMemo(() => (Array.isArray(templates.data) ? templates.data : null), [templates.data]);
  const usable = useMemo(() => (event || !templateList ? [] : templateList.filter((t) => t.status === "READY")), [event, templateList]);
  const [template, setTemplate] = useState<MeetingTemplate | null>(null);
  const seededTemplate = useRef(false);
  const applyTemplate = (t: MeetingTemplate | null) => {
    setTemplate(t);
    if (!t) return;
    setTitle(t.title);
    setDescription(t.agenda ?? "");
    const detail = t.locationDetail?.trim() ?? "";
    if (t.locationType === "VIDEO") {
      setVideoLink(/^https?:\/\//i.test(detail) ? detail : "");
      setLocation(detail && !/^https?:\/\//i.test(detail) ? detail : "");
    } else {
      setVideoLink("");
      setLocation(t.locationType === "PHONE" ? (detail ? `Phone: ${detail}` : "Phone call") : detail);
    }
    setAttendeesTouched(true);
    setAttendees((current) => Array.from(new Set([...current, ...t.defaultAttendees])));
    if (t.teamCalendarId && calendars.some((c) => c.id === t.teamCalendarId)) setCalendarId(t.teamCalendarId);
    // Keep the chosen start unless it is too soon for the template's notice.
    const chosen = allDay ? fromInputs(startDate, "09:00") : fromInputs(startDate, startTime);
    const earliest = Date.now() + t.minNoticeHours * 3_600_000;
    const begin = chosen.getTime() >= earliest ? chosen : roundUpQuarter(new Date(earliest));
    const finish = new Date(begin.getTime() + t.durationMinutes * 60_000);
    setAllDay(false);
    setStartDate(toDateInput(begin));
    setStartTime(toTimeInput(begin));
    setEndDate(toDateInput(finish));
    setEndTime(toTimeInput(finish));
  };
  useEffect(() => {
    if (seededTemplate.current || !seed?.templateId || !templateList) return;
    seededTemplate.current = true;
    const found = templateList.find((t) => t.id === seed.templateId);
    if (found) applyTemplate(found);
    // applyTemplate reads the current form once, when the templates arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.templateId, templateList]);

  // Editing: who is already invited comes with the full event.
  const loaded = useOwnEvent(event?.id ?? null);
  const attendeeNames = useMemo(
    () => Object.fromEntries((loaded.data?.attendees ?? []).filter((a) => a.displayName).map((a) => [a.email, a.displayName!])),
    [loaded.data]
  );
  useEffect(() => {
    if (loaded.data && !attendeesTouched) setAttendees(loaded.data.attendees.map((a) => a.email));
  }, [loaded.data, attendeesTouched]);

  const create = useCreateEvent();
  const update = useUpdateEvent();
  const remove = useDeleteEvent();
  const busy = create.isPending || update.isPending || remove.isPending;
  const serverError = (create.error ?? update.error ?? remove.error) as Error | null;

  const start = allDay ? fromInputs(startDate, "00:00") : fromInputs(startDate, startTime);
  const end = allDay ? fromInputs(endDate, "00:00") : fromInputs(endDate, endTime);
  const bufferMs = (template?.bufferMinutes ?? 0) * 60_000;
  const timesValid = !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end > start;
  const checkFrom = new Date(start.getTime() - bufferMs);
  const checkTo = new Date(end.getTime() + bufferMs);
  const availability = useQuery({
    queryKey: ["calendar", "template-check", attendees.join(","), checkFrom.getTime(), checkTo.getTime()],
    queryFn: () => freeBusy(attendees, checkFrom, checkTo, true),
    enabled: Boolean(template) && timesValid && !allDay,
    staleTime: 15_000,
  });
  const people = availability.data ?? [];
  const clash = (people.find((p) => p.isMe)?.busy ?? []).some((b) => new Date(b.start) < checkTo && new Date(b.end) > checkFrom);
  const known = new Set(people.map((p) => p.email.toLowerCase()));
  const outside = availability.data ? attendees.filter((a) => !known.has(a.toLowerCase())) : [];
  const templateProblem = !template
    ? null
    : allDay
      ? "Meetings from a template have a start and end time."
      : start.getTime() < Date.now() + template.minNoticeHours * 3_600_000 - 60_000
        ? `This template needs at least ${template.minNoticeHours} hour${template.minNoticeHours === 1 ? "" : "s"} notice.`
        : clash
          ? `This overlaps something in your calendar${template.bufferMinutes ? ` (with the ${template.bufferMinutes}-minute buffer)` : ""}. Choose another time.`
          : template.externalGuests === "NOT_ALLOWED" && outside.length
            ? `This template is for workspace members only. Remove ${outside.join(", ")}.`
            : null;
  const problems = {
    title: title.trim() ? (title.trim().length > 200 ? "Keep the title to 200 characters." : null) : "Give the event a title.",
    calendar: calendarId ? null : "Choose a calendar.",
    dates:
      !startDate || !endDate || (!allDay && (!startTime || !endTime))
        ? "Choose a start and an end."
        : allDay
          ? end < start
            ? "The last day cannot be before the first."
            : null
          : end <= start
            ? "The event must end after it starts."
            : end.getTime() - start.getTime() > 7 * 86_400_000
              ? "An event can last at most 7 days. Use All day for longer."
              : null,
    videoLink: videoLink.trim() && !/^https?:\/\/\S+$/i.test(videoLink.trim()) ? "Enter a full link, starting with https://" : null,
    template: templateProblem,
  };
  const valid = Object.values(problems).every((p) => p === null);
  const show = (key: keyof typeof problems) => (touched ? problems[key] : null);

  const save = () => {
    setTouched(true);
    if (!valid || busy) return;
    const input: EventInput = {
      calendarId,
      title: title.trim(),
      description: description.trim() || null,
      location: location.trim() || null,
      videoLink: videoLink.trim() || null,
      allDay,
      // All-day: whole days in UTC, end exclusive (the day after the last day).
      startsAt: allDay ? allDayToUtc(startDate) : start.toISOString(),
      endsAt: allDay ? allDayToUtc(toDateInput(addDays(fromInputs(endDate, "00:00"), 1))) : end.toISOString(),
      timeZone: event ? localZone().zone : preferredZone(),
      visibility: isPrivate ? "PRIVATE" : "DEFAULT",
      showAs,
      // Sent when creating with guests, or when the list was loaded or changed —
      // never as an empty list that would uninvite everyone before it loaded.
      ...(event ? (loaded.data || attendeesTouched ? { attendees } : {}) : attendees.length ? { attendees } : {}),
    };
    if (event) update.mutate({ id: event.id, input }, { onSuccess: onClose });
    else create.mutate(input, { onSuccess: onClose });
  };

  // Moving the start keeps the length, the way calendars usually behave.
  const moveStart = (date: string, time: string) => {
    const previousStart = allDay ? fromInputs(startDate, "00:00") : fromInputs(startDate, startTime);
    const previousEnd = allDay ? fromInputs(endDate, "00:00") : fromInputs(endDate, endTime);
    const length = Math.max(0, previousEnd.getTime() - previousStart.getTime());
    const nextStart = fromInputs(date, allDay ? "00:00" : time);
    const nextEnd = new Date(nextStart.getTime() + length);
    setStartDate(date);
    setStartTime(time);
    setEndDate(toDateInput(nextEnd));
    if (!allDay) setEndTime(toTimeInput(nextEnd));
  };

  const selected = calendars.find((c) => c.id === calendarId);

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title={event ? "Edit event" : "New event"}
      size="lg"
      footer={
        <>
          {event && !confirmDelete && (
            <button
              type="button"
              className="zoiko-btn mr-auto text-[var(--crit)]"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-4 w-4" aria-hidden /> Delete
            </button>
          )}
          {event && confirmDelete && (
            <span className="mr-auto flex items-center gap-2 text-[12.5px] text-[var(--ink2)]">
              Delete this event?
              <button
                type="button"
                className="zoiko-btn sm text-[var(--crit)]"
                disabled={busy}
                onClick={() => remove.mutate(event.id, { onSuccess: onClose })}
              >
                {remove.isPending ? "Deleting…" : "Yes, delete"}
              </button>
              <button type="button" className="zoiko-btn sm" disabled={busy} onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </span>
          )}
          <button type="button" className="zoiko-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="zoiko-btn pri" onClick={save} disabled={busy}>
            {create.isPending || update.isPending ? "Saving…" : event ? "Save changes" : "Create event"}
          </button>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="flex flex-col gap-4"
      >
        {!event && usable.length > 0 && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--s2)] p-3" data-testid="template-picker">
            <label htmlFor="ev-template" className={label}>
              <LayoutTemplate className="mr-1 inline h-3.5 w-3.5" aria-hidden />
              Start from a template
            </label>
            <select
              id="ev-template"
              className="zoiko-input w-full"
              value={template?.id ?? ""}
              onChange={(e) => applyTemplate(usable.find((t) => t.id === e.target.value) ?? null)}
            >
              <option value="">No template</option>
              {usable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} · {t.durationMinutes} min{t.scope === "TEAM" ? ` · ${t.teamCalendar?.name ?? "Team"}` : ""}
                </option>
              ))}
            </select>
            {template && (
              <p className="mt-2 text-[11.5px] text-[var(--ink3)]" data-testid="template-rules">
                Conflict check on
                {template.bufferMinutes ? ` · ${template.bufferMinutes}-min buffer` : ""}
                {template.minNoticeHours ? ` · ${template.minNoticeHours}h notice` : ""}
                {" · "}
                {template.externalGuests === "NOT_ALLOWED" ? "Members only" : template.externalGuests === "APPROVAL" ? "Outside guests: confirm before sending" : "Outside guests allowed"}
                {" · "}
                {template.recordingAllowed ? "Recording allowed" : "No recording"}
              </p>
            )}
            {template?.externalGuests === "APPROVAL" && outside.length > 0 && (
              <p className="mt-1 flex items-center gap-1 text-[11.5px] text-[#E0A33A]">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Outside guests: {outside.join(", ")}. Check before you create the meeting.
              </p>
            )}
            {touched && problems.template && (
              <p role="alert" className={problemText}>
                {problems.template}
              </p>
            )}
          </div>
        )}
        <div>
          <label htmlFor="ev-title" className={label}>
            Title
          </label>
          <input
            id="ev-title"
            className="zoiko-input w-full text-[15px]"
            value={title}
            autoFocus
            placeholder="Add a title"
            onChange={(e) => setTitle(e.target.value)}
            aria-invalid={Boolean(show("title"))}
          />
          {show("title") && <p className={problemText}>{show("title")}</p>}
        </div>

        <div>
          <label htmlFor="ev-attendees" className={label}>
            <Users className="mr-1 inline h-3.5 w-3.5" aria-hidden />
            Invite people
          </label>
          <AttendeeInput
            inputId="ev-attendees"
            value={attendees}
            names={attendeeNames}
            onChange={(next) => {
              setAttendeesTouched(true);
              setAttendees(next);
            }}
          />
          {event && loaded.isLoading && <p className="mt-1 text-[11.5px] text-[var(--ink3)]">Loading who is invited…</p>}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ev-calendar" className={label}>
              Calendar
            </label>
            <div className="relative">
              <span
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full"
                style={swatchStyle(selected?.color)}
              />
              <select
                id="ev-calendar"
                className="zoiko-input w-full"
                style={{ paddingLeft: 30 }}
                value={calendarId}
                onChange={(e) => setCalendarId(e.target.value)}
              >
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            {show("calendar") && <p className={problemText}>{show("calendar")}</p>}
          </div>
          <div className="flex items-end gap-4 pb-2">
            <label className="flex items-center gap-2 text-[13px] text-[var(--ink)]">
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
              All day
            </label>
            <label className="flex items-center gap-2 text-[13px] text-[var(--ink)]">
              <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
              <Lock className="h-3.5 w-3.5 text-[var(--ink3)]" aria-hidden /> Private
            </label>
          </div>
        </div>

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">When</legend>
          <div className="flex gap-2">
            <div className="flex-1">
              <label htmlFor="ev-start-date" className={label}>
                {allDay ? "First day" : "Starts"}
              </label>
              <input
                id="ev-start-date"
                type="date"
                className="zoiko-input w-full"
                value={startDate}
                onChange={(e) => moveStart(e.target.value, startTime)}
              />
            </div>
            {!allDay && (
              <div className="w-[110px]">
                <label htmlFor="ev-start-time" className={label}>
                  <span className="sr-only">Start </span>Time
                </label>
                <input
                  id="ev-start-time"
                  type="time"
                  step={300}
                  className="zoiko-input w-full"
                  value={startTime}
                  onChange={(e) => moveStart(startDate, e.target.value)}
                />
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label htmlFor="ev-end-date" className={label}>
                {allDay ? "Last day" : "Ends"}
              </label>
              <input
                id="ev-end-date"
                type="date"
                className="zoiko-input w-full"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            {!allDay && (
              <div className="w-[110px]">
                <label htmlFor="ev-end-time" className={label}>
                  <span className="sr-only">End </span>Time
                </label>
                <input
                  id="ev-end-time"
                  type="time"
                  step={300}
                  className="zoiko-input w-full"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            )}
          </div>
          {show("dates") && <p className={`${problemText} sm:col-span-2`}>{show("dates")}</p>}
          <p className="text-[11.5px] text-[var(--ink3)] sm:col-span-2">Times are in {localZone().label}.</p>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ev-location" className={label}>
              <MapPin className="mr-1 inline h-3.5 w-3.5" aria-hidden />
              Location
            </label>
            <input
              id="ev-location"
              className="zoiko-input w-full"
              value={location}
              placeholder="Room, address or “Video meeting”"
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="ev-video" className={label}>
              <Video className="mr-1 inline h-3.5 w-3.5" aria-hidden />
              Video link
            </label>
            <input
              id="ev-video"
              className="zoiko-input w-full"
              value={videoLink}
              placeholder="https://"
              inputMode="url"
              onChange={(e) => setVideoLink(e.target.value)}
              aria-invalid={Boolean(show("videoLink"))}
            />
            {show("videoLink") && <p className={problemText}>{show("videoLink")}</p>}
          </div>
        </div>

        <div>
          <label htmlFor="ev-description" className={label}>
            <AlignLeft className="mr-1 inline h-3.5 w-3.5" aria-hidden />
            Agenda or notes
          </label>
          <textarea
            id="ev-description"
            className="zoiko-input min-h-[84px] w-full resize-y"
            value={description}
            placeholder="What is this meeting for?"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div>
          <span className={label}>Show me as</span>
          <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5" role="radiogroup" aria-label="Show me as">
            {(["BUSY", "FREE"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={showAs === value}
                onClick={() => setShowAs(value)}
                className={`rounded-md px-3 py-1 text-[12.5px] ${
                  showAs === value ? "bg-[var(--accent)] text-white" : "text-[var(--ink2)] hover:bg-[var(--s2)]"
                }`}
              >
                {value === "BUSY" ? "Busy" : "Free"}
              </button>
            ))}
          </div>
        </div>

        {serverError && (
          <p role="alert" className="text-[12.5px] text-[var(--crit)]">
            {serverError.message}
          </p>
        )}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

/** The next half-hour boundary from now. */
function roundUpQuarter(d: Date): Date {
  const r = new Date(d);
  r.setSeconds(0, 0);
  r.setMinutes(Math.ceil(r.getMinutes() / 15) * 15);
  return r;
}

function nextHalfHour(): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60);
  return d;
}
