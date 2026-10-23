"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCalendar,
  createEvent,
  deleteCalendar,
  deleteEvent,
  getEvent,
  getEventDetail,
  invitationCounts,
  listCalendars,
  listEvents,
  listInvitations,
  markEventSeen,
  proposeEventTime,
  respondToEvent,
  searchPeople,
  updateCalendar,
  updateEvent,
  createTeamCalendar,
  decideAccessRequest,
  findTime,
  freeBusy,
  listAccessibleCalendars,
  listAccessRequests,
  listScopedEvents,
  listShares,
  removeShare,
  requestCalendarAccess,
  shareCalendar,
  bookResource,
  cancelBooking,
  createResource,
  decideBooking,
  listResources,
  myBookings,
  pendingBookings,
  resourceBoard,
  updateResource,
  bookingLinkSlots,
  cancelGuestBooking,
  createBookingLink,
  decideGuestBooking,
  deleteBookingLink,
  listBookingLinks,
  listTemplates,
  getPreferences,
  updatePreferences,
  DEFAULT_CALENDAR_PREFERENCES,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  duplicateTemplate,
  reviewTemplate,
  listGuestBookings,
  updateBookingLink,
  type CalendarAccess,
  type Calendar,
  type CalendarColor,
  type EventInput,
  type EventResponse,
  type InvitationTab,
} from "./calendar-api";

/** Every calendar query lives under this key, so one invalidation refreshes them all. */
export const CALENDAR_ROOT = ["calendar"] as const;
const CALENDARS_KEY = ["calendar", "calendars"] as const;
const EVENTS_KEY = ["calendar", "events"] as const;

export function useCalendars() {
  return useQuery({ queryKey: CALENDARS_KEY, queryFn: listCalendars, staleTime: 60_000 });
}

/** Events overlapping [from, to). The range is part of the key, so each view caches its own. */
export function useCalendarEvents(from: Date, to: Date) {
  return useQuery({
    queryKey: [...EVENTS_KEY, from.toISOString(), to.toISOString()],
    queryFn: () => listEvents(from, to),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
}

/** One of my events with its attendees, for the edit dialog. */
export function useOwnEvent(id: string | null) {
  return useQuery({
    queryKey: ["calendar", "event", id],
    queryFn: () => getEvent(id!),
    enabled: Boolean(id),
  });
}

/**
 * Events, invitations, counts and details all move together (an answer
 * changes a list, a badge and a calendar), so a change refreshes everything
 * calendar-related rather than guessing which caches it touched.
 */
function useInvalidateCalendar() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: CALENDAR_ROOT });
}

export function useCreateEvent() {
  const invalidate = useInvalidateCalendar();
  return useMutation({ mutationFn: (input: EventInput) => createEvent(input), onSuccess: invalidate });
}

export function useUpdateEvent() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<EventInput> }) => updateEvent(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteEvent() {
  const invalidate = useInvalidateCalendar();
  return useMutation({ mutationFn: (id: string) => deleteEvent(id), onSuccess: invalidate });
}

export function useCreateCalendar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; color: CalendarColor }) => createCalendar(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CALENDARS_KEY }),
  });
}

/**
 * Rename, recolour or show/hide a calendar. The checkbox flips at once
 * (optimistic) and settles to what the server stored.
 */
export function useUpdateCalendar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateCalendar>[1] }) => updateCalendar(id, input),
    onMutate: async ({ id, input }) => {
      await queryClient.cancelQueries({ queryKey: CALENDARS_KEY });
      const previous = queryClient.getQueryData<Calendar[]>(CALENDARS_KEY);
      queryClient.setQueryData<Calendar[]>(CALENDARS_KEY, (list) =>
        list?.map((c) => (c.id === id ? ({ ...c, ...input } as Calendar) : c))
      );
      return { previous };
    },
    onError: (_error, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(CALENDARS_KEY, ctx.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: CALENDARS_KEY }),
  });
}

export function useDeleteCalendar() {
  const invalidate = useInvalidateCalendar();
  return useMutation({ mutationFn: (id: string) => deleteCalendar(id), onSuccess: invalidate });
}

// ── Invitations ─────────────────────────────────────────────────────────────

export function useInvitations(tab: InvitationTab, q: string) {
  return useQuery({
    queryKey: ["calendar", "invitations", tab, q],
    queryFn: () => listInvitations(tab, q || undefined),
    staleTime: 15_000,
    placeholderData: (previous) => previous,
  });
}

export function useInvitationCounts() {
  return useQuery({ queryKey: ["calendar", "invitation-counts"], queryFn: invitationCounts, staleTime: 15_000 });
}

export function useEventDetail(id: string | null) {
  return useQuery({
    queryKey: ["calendar", "detail", id],
    queryFn: () => getEventDetail(id!),
    enabled: Boolean(id),
  });
}

export function usePeopleSearch(q: string) {
  return useQuery({
    queryKey: ["calendar", "people", q],
    queryFn: () => searchPeople(q),
    staleTime: 60_000,
  });
}

export function useMarkSeen() {
  const invalidate = useInvalidateCalendar();
  return useMutation({ mutationFn: (id: string) => markEventSeen(id), onSuccess: invalidate });
}

export function useRespond() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: ({ id, response, comment }: { id: string; response: Exclude<EventResponse, "NEEDS_ACTION">; comment?: string }) =>
      respondToEvent(id, response, comment),
    onSuccess: invalidate,
  });
}

export function useProposeTime() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: ({ id, startsAt, endsAt, comment }: { id: string; startsAt: string; endsAt: string; comment?: string }) =>
      proposeEventTime(id, { startsAt, endsAt, comment }),
    onSuccess: invalidate,
  });
}

// ── Sharing, team calendars, free/busy ──────────────────────────────────────

export function useAccessibleCalendars() {
  return useQuery({ queryKey: ["calendar", "accessible"], queryFn: listAccessibleCalendars, staleTime: 60_000 });
}

export function useScopedEvents(scope: "team" | "shared", from: Date, to: Date) {
  return useQuery({
    queryKey: ["calendar", "scoped", scope, from.toISOString(), to.toISOString()],
    queryFn: () => listScopedEvents(scope, from, to),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
}

export function useShares(calendarId: string | null) {
  return useQuery({
    queryKey: ["calendar", "shares", calendarId],
    queryFn: () => listShares(calendarId!),
    enabled: Boolean(calendarId),
    retry: false,
  });
}

export function useAccessRequests() {
  return useQuery({ queryKey: ["calendar", "access-requests"], queryFn: listAccessRequests, staleTime: 15_000 });
}

/** Busy times for these people (by address). Waits until there is someone to ask about. */
export function useFreeBusy(emails: string[], from: Date, to: Date, includeMe = false) {
  const key = [...emails].sort().join(",");
  return useQuery({
    queryKey: ["calendar", "freebusy", key, from.toISOString(), to.toISOString(), includeMe],
    queryFn: () => freeBusy(emails, from, to, includeMe),
    enabled: emails.length > 0 || includeMe,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
}

export function useCreateTeamCalendar() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: (input: { name: string; color: CalendarColor; members: string[] }) => createTeamCalendar(input),
    onSuccess: invalidate,
  });
}

export function useShareCalendar() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: ({ calendarId, email, access }: { calendarId: string; email: string; access: CalendarAccess }) =>
      shareCalendar(calendarId, email, access),
    onSuccess: invalidate,
  });
}

export function useRemoveShare() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: ({ calendarId, shareId }: { calendarId: string; shareId: string }) => removeShare(calendarId, shareId),
    onSuccess: invalidate,
  });
}

export function useRequestAccess() {
  const invalidate = useInvalidateCalendar();
  return useMutation({ mutationFn: requestCalendarAccess, onSuccess: invalidate });
}

export function useDecideAccessRequest() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: ({ id, approve, access }: { id: string; approve: boolean; access?: CalendarAccess }) =>
      decideAccessRequest(id, approve, access),
    onSuccess: invalidate,
  });
}

export function useFindTime() {
  return useMutation({ mutationFn: findTime });
}

// ── Rooms and resources ─────────────────────────────────────────────────────

export function useResources() {
  return useQuery({ queryKey: ["calendar", "resources"], queryFn: listResources, staleTime: 60_000 });
}

export function useResourceBoard(from: Date, to: Date) {
  return useQuery({
    queryKey: ["calendar", "resource-board", from.toISOString(), to.toISOString()],
    queryFn: () => resourceBoard(from, to),
    staleTime: 15_000,
    placeholderData: (previous) => previous,
  });
}

export function useMyBookings() {
  return useQuery({ queryKey: ["calendar", "bookings", "mine"], queryFn: myBookings, staleTime: 15_000 });
}

/** Pending bookings; only Owners and Admins may read them, so it is asked for only when `enabled`. */
export function usePendingBookings(enabled: boolean) {
  return useQuery({ queryKey: ["calendar", "bookings", "pending"], queryFn: pendingBookings, staleTime: 15_000, enabled, retry: false });
}

export function useBookResource() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: ({ resourceId, input }: { resourceId: string; input: Parameters<typeof bookResource>[1] }) => bookResource(resourceId, input),
    onSuccess: invalidate,
  });
}

export function useCreateResource() {
  const invalidate = useInvalidateCalendar();
  return useMutation({ mutationFn: createResource, onSuccess: invalidate });
}

export function useUpdateResource() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateResource>[1] }) => updateResource(id, input),
    onSuccess: invalidate,
  });
}

export function useDecideBooking() {
  const invalidate = useInvalidateCalendar();
  return useMutation({ mutationFn: ({ id, approve }: { id: string; approve: boolean }) => decideBooking(id, approve), onSuccess: invalidate });
}

export function useCancelBooking() {
  const invalidate = useInvalidateCalendar();
  return useMutation({ mutationFn: (id: string) => cancelBooking(id), onSuccess: invalidate });
}

// ── Scheduling links ────────────────────────────────────────────────────────

export function useBookingLinks() {
  return useQuery({ queryKey: ["calendar", "booking-links"], queryFn: listBookingLinks, staleTime: 30_000 });
}

export function useBookingLinkSlots(id: string | null, from: Date, to: Date) {
  return useQuery({
    queryKey: ["calendar", "booking-link-slots", id, from.toISOString(), to.toISOString()],
    queryFn: () => bookingLinkSlots(id!, from, to),
    enabled: Boolean(id),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
}

export function useGuestBookings() {
  return useQuery({ queryKey: ["calendar", "guest-bookings"], queryFn: listGuestBookings, staleTime: 15_000 });
}

export function useCreateBookingLink() {
  const invalidate = useInvalidateCalendar();
  return useMutation({ mutationFn: createBookingLink, onSuccess: invalidate });
}

export function useUpdateBookingLink() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateBookingLink>[1] }) => updateBookingLink(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteBookingLink() {
  const invalidate = useInvalidateCalendar();
  return useMutation({ mutationFn: (id: string) => deleteBookingLink(id), onSuccess: invalidate });
}

export function useDecideGuestBooking() {
  const invalidate = useInvalidateCalendar();
  return useMutation({ mutationFn: ({ id, approve }: { id: string; approve: boolean }) => decideGuestBooking(id, approve), onSuccess: invalidate });
}

export function useCancelGuestBooking() {
  const invalidate = useInvalidateCalendar();
  return useMutation({ mutationFn: (id: string) => cancelGuestBooking(id), onSuccess: invalidate });
}

// ── Meeting templates ───────────────────────────────────────────────────────

export function useTemplates() {
  return useQuery({ queryKey: ["calendar", "templates"], queryFn: listTemplates, staleTime: 30_000 });
}

export function useCreateTemplate() {
  const invalidate = useInvalidateCalendar();
  return useMutation({ mutationFn: createTemplate, onSuccess: invalidate });
}

export function useUpdateTemplate() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof updateTemplate>[1] }) => updateTemplate(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteTemplate() {
  const invalidate = useInvalidateCalendar();
  return useMutation({ mutationFn: (id: string) => deleteTemplate(id), onSuccess: invalidate });
}

export function useDuplicateTemplate() {
  const invalidate = useInvalidateCalendar();
  return useMutation({ mutationFn: (id: string) => duplicateTemplate(id), onSuccess: invalidate });
}

export function useReviewTemplate() {
  const invalidate = useInvalidateCalendar();
  return useMutation({
    mutationFn: ({ id, approve, note }: { id: string; approve: boolean; note?: string }) => reviewTemplate(id, approve, note),
    onSuccess: invalidate,
  });
}

// ── Preferences ─────────────────────────────────────────────────────────────

export function useCalendarPreferences() {
  return useQuery({ queryKey: ["calendar-preferences"], queryFn: getPreferences, staleTime: 5 * 60_000, retry: 1 });
}

/** Saving preferences re-applies them everywhere (the calendar pages read them on render). */
export function useUpdatePreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updatePreferences,
    onSuccess: (saved) => {
      queryClient.setQueryData(["calendar-preferences"], { ...DEFAULT_CALENDAR_PREFERENCES, ...saved });
    },
  });
}

/** The preferences in effect: saved ones, or the defaults while loading or if they cannot be read. */
export function usePrefs() {
  return useCalendarPreferences().data ?? DEFAULT_CALENDAR_PREFERENCES;
}
