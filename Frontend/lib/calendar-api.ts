import { apiRequest } from "./api-client";

/** Palette keys a calendar can be shown in; the server accepts only these. */
export const CALENDAR_COLORS = ["blue", "green", "purple", "amber", "teal", "red", "slate"] as const;
export type CalendarColor = (typeof CALENDAR_COLORS)[number];

export interface Calendar {
  id: string;
  kind: "PERSONAL" | "TEAM";
  name: string;
  color: CalendarColor;
  description: string | null;
  isDefault: boolean;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
}

export type EventResponse = "NEEDS_ACTION" | "ACCEPTED" | "TENTATIVE" | "DECLINED";

export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  description: string | null;
  location: string | null;
  videoLink: string | null;
  /** ISO instant. For all-day events, midnight UTC of the first day. */
  startsAt: string;
  /** ISO instant. For all-day events, midnight UTC after the last day. */
  endsAt: string;
  allDay: boolean;
  timeZone: string;
  visibility: "DEFAULT" | "PRIVATE";
  showAs: "BUSY" | "FREE";
  createdAt: string;
  updatedAt: string;
  /** OWN: in one of my calendars. INVITED: another member's event I am invited to. */
  source?: "OWN" | "INVITED";
  /** My answer, for an invited event. */
  myResponse?: EventResponse | null;
  /** Who organised it, for an invited event. */
  organizerName?: string | null;
  attendeeCount?: number;
}

/** An event of mine as the edit dialog loads it: with who is invited. */
export interface OwnEvent extends CalendarEvent {
  sequence: number;
  attendees: Array<{ email: string; displayName: string | null; response: EventResponse }>;
}

export interface EventInput {
  calendarId: string;
  title: string;
  description?: string | null;
  location?: string | null;
  videoLink?: string | null;
  startsAt: string;
  endsAt: string;
  allDay?: boolean;
  timeZone?: string;
  visibility?: "DEFAULT" | "PRIVATE";
  showAs?: "BUSY" | "FREE";
  /** Everyone invited, after the change. */
  attendees?: string[];
}

export function listCalendars(): Promise<Calendar[]> {
  return apiRequest<Calendar[]>("/calendar/calendars");
}

export function createCalendar(input: { name: string; color: CalendarColor; description?: string }): Promise<Calendar> {
  return apiRequest<Calendar>("/calendar/calendars", { method: "POST", body: input });
}

export function updateCalendar(
  id: string,
  input: Partial<Pick<Calendar, "name" | "color" | "isVisible">> & { description?: string | null }
): Promise<Calendar> {
  return apiRequest<Calendar>(`/calendar/calendars/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
}

export async function deleteCalendar(id: string): Promise<void> {
  await apiRequest<null>(`/calendar/calendars/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function listEvents(from: Date, to: Date): Promise<CalendarEvent[]> {
  const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  return apiRequest<CalendarEvent[]>(`/calendar/events?${query.toString()}`);
}

export function getEvent(id: string): Promise<OwnEvent> {
  return apiRequest<OwnEvent>(`/calendar/events/${encodeURIComponent(id)}`);
}

export function createEvent(input: EventInput): Promise<OwnEvent> {
  return apiRequest<OwnEvent>("/calendar/events", { method: "POST", body: input });
}

export function updateEvent(id: string, input: Partial<EventInput>): Promise<OwnEvent> {
  return apiRequest<OwnEvent>(`/calendar/events/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
}

export async function deleteEvent(id: string): Promise<void> {
  await apiRequest<null>(`/calendar/events/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ── Invitations ─────────────────────────────────────────────────────────────

export type InvitationTab = "awaiting" | "all" | "updates" | "accepted" | "sent";

export interface ResponseCounts {
  accepted: number;
  tentative: number;
  declined: number;
  needsAction: number;
}

export interface InvitationItem {
  eventId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timeZone: string;
  location: string | null;
  videoLink: string | null;
  organizer: { name: string | null; email: string };
  attendeeCount: number;
  /** Null on the Sent tab (I organised it). */
  myResponse: EventResponse | null;
  isNew: boolean;
  hasUpdate: boolean;
  receivedAt: string;
  responses: ResponseCounts;
}

export interface EventAttendeeView {
  id: string;
  email: string;
  name: string;
  isMember: boolean;
  isMe: boolean;
  response: EventResponse;
  respondedAt: string | null;
  comment: string | null;
  proposedStartsAt: string | null;
  proposedEndsAt: string | null;
}

export interface EventHistoryEntry {
  id: string;
  type: "INVITED" | "RESPONDED" | "PROPOSED_TIME" | "UPDATED" | "REMOVED";
  detail: Record<string, unknown>;
  actorName: string;
  createdAt: string;
}

export interface EventDetail {
  id: string;
  calendarId: string | null;
  calendarName: string | null;
  calendarColor: CalendarColor | null;
  title: string;
  description: string | null;
  location: string | null;
  videoLink: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timeZone: string;
  visibility: "DEFAULT" | "PRIVATE";
  showAs: "BUSY" | "FREE";
  sequence: number;
  isOrganizer: boolean;
  organizer: { membershipId: string; name: string | null; email: string };
  myResponse: EventResponse | null;
  myComment: string | null;
  receivedAt: string | null;
  hasUpdate: boolean;
  isNew: boolean;
  counts: ResponseCounts;
  attendees: EventAttendeeView[];
  history: EventHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export function listInvitations(tab: InvitationTab, q?: string): Promise<InvitationItem[]> {
  const query = new URLSearchParams({ tab });
  if (q) query.set("q", q);
  return apiRequest<InvitationItem[]>(`/calendar/invitations?${query.toString()}`);
}

export function invitationCounts(): Promise<{ awaiting: number; updates: number }> {
  return apiRequest("/calendar/invitations/counts");
}

export function searchPeople(q: string): Promise<Array<{ email: string; name: string | null }>> {
  return apiRequest(`/calendar/people?${new URLSearchParams({ q }).toString()}`);
}

export function getEventDetail(id: string): Promise<EventDetail> {
  return apiRequest<EventDetail>(`/calendar/events/${encodeURIComponent(id)}/details`);
}

export async function markEventSeen(id: string): Promise<void> {
  await apiRequest<null>(`/calendar/events/${encodeURIComponent(id)}/seen`, { method: "POST" });
}

export function respondToEvent(
  id: string,
  response: Exclude<EventResponse, "NEEDS_ACTION">,
  comment?: string
): Promise<EventDetail> {
  return apiRequest<EventDetail>(`/calendar/events/${encodeURIComponent(id)}/respond`, {
    method: "POST",
    body: comment ? { response, comment } : { response },
  });
}

export function proposeEventTime(
  id: string,
  input: { startsAt: string; endsAt: string; comment?: string }
): Promise<EventDetail> {
  return apiRequest<EventDetail>(`/calendar/events/${encodeURIComponent(id)}/propose`, { method: "POST", body: input });
}

// ── Sharing, team calendars, free/busy ──────────────────────────────────────

export type CalendarAccess = "FREE_BUSY" | "VIEW" | "EDIT" | "MANAGE";
export type EffectiveAccess = CalendarAccess | "OWNER";

/** A calendar the caller can see something of, with their access and their own show/hide choice. */
export interface AccessibleCalendar {
  id: string;
  kind: "PERSONAL" | "TEAM";
  name: string;
  color: CalendarColor;
  description: string | null;
  isDefault: boolean;
  isVisible: boolean;
  access: EffectiveAccess;
  /** Null for the caller's own calendars. */
  owner: { name: string; email: string } | null;
  sharedWithCount: number;
}

/** An event in a team or shared calendar, reduced to Busy where the caller may not read it. */
export interface ScopedEvent extends CalendarEvent {
  access: EffectiveAccess;
  canEdit: boolean;
  redacted: boolean;
}

export interface CalendarShareView {
  id: string;
  membershipId: string;
  name: string;
  email: string;
  access: CalendarAccess;
  isMe: boolean;
}

export interface CalendarSharesView {
  calendarId: string;
  owner: { membershipId: string; name: string; email: string } | null;
  shares: CalendarShareView[];
}

export interface AccessRequestView {
  id: string;
  access: CalendarAccess;
  message: string | null;
  status: "PENDING" | "APPROVED" | "DECLINED";
  createdAt: string;
  decidedAt: string | null;
  calendar: { id: string; name: string; ownerName: string | null };
  requester: { name: string; email: string };
}

export interface FreeBusyPerson {
  membershipId: string;
  name: string;
  email: string;
  isMe: boolean;
  busy: Array<{ start: string; end: string }>;
}

export function listAccessibleCalendars(): Promise<AccessibleCalendar[]> {
  return apiRequest<AccessibleCalendar[]>("/calendar/accessible");
}

export function createTeamCalendar(input: { name: string; color: CalendarColor; members: string[] }): Promise<Calendar> {
  return apiRequest<Calendar>("/calendar/team-calendars", { method: "POST", body: input });
}

export function listScopedEvents(scope: "team" | "shared", from: Date, to: Date): Promise<ScopedEvent[]> {
  const query = new URLSearchParams({ scope, from: from.toISOString(), to: to.toISOString() });
  return apiRequest<ScopedEvent[]>(`/calendar/scoped-events?${query.toString()}`);
}

export function listShares(calendarId: string): Promise<CalendarSharesView> {
  return apiRequest<CalendarSharesView>(`/calendar/calendars/${encodeURIComponent(calendarId)}/shares`);
}

export function shareCalendar(calendarId: string, email: string, access: CalendarAccess): Promise<CalendarSharesView> {
  return apiRequest<CalendarSharesView>(`/calendar/calendars/${encodeURIComponent(calendarId)}/shares`, {
    method: "POST",
    body: { email, access },
  });
}

export async function removeShare(calendarId: string, shareId: string): Promise<void> {
  await apiRequest<null>(`/calendar/calendars/${encodeURIComponent(calendarId)}/shares/${encodeURIComponent(shareId)}`, {
    method: "DELETE",
  });
}

export function requestCalendarAccess(input: {
  calendarId?: string;
  ownerEmail?: string;
  access: CalendarAccess;
  message?: string;
}): Promise<{ id: string; calendarId: string; status: "PENDING" }> {
  return apiRequest("/calendar/access-requests", { method: "POST", body: input });
}

export function listAccessRequests(): Promise<{ incoming: AccessRequestView[]; outgoing: AccessRequestView[] }> {
  return apiRequest("/calendar/access-requests");
}

export function decideAccessRequest(id: string, approve: boolean, access?: CalendarAccess) {
  return apiRequest<{ incoming: AccessRequestView[]; outgoing: AccessRequestView[] }>(
    `/calendar/access-requests/${encodeURIComponent(id)}/decision`,
    { method: "POST", body: access ? { approve, access } : { approve } }
  );
}

export function freeBusy(emails: string[], from: Date, to: Date, includeMe = false): Promise<FreeBusyPerson[]> {
  const query = new URLSearchParams({
    emails: emails.join(","),
    from: from.toISOString(),
    to: to.toISOString(),
    includeMe: String(includeMe),
  });
  return apiRequest<FreeBusyPerson[]>(`/calendar/freebusy?${query.toString()}`);
}

export interface FindTimeResult {
  people: Array<{ membershipId: string; name: string; email: string; isMe: boolean }>;
  slots: Array<{ start: string; end: string }>;
}

export function findTime(input: {
  emails: string[];
  from: string;
  to: string;
  durationMinutes: number;
  timeZone: string;
  dayStartHour?: number;
  dayEndHour?: number;
  limit?: number;
}): Promise<FindTimeResult> {
  return apiRequest<FindTimeResult>("/calendar/find-time", { method: "POST", body: input });
}

// ── Rooms and resources ─────────────────────────────────────────────────────

export interface CalendarResource {
  id: string;
  kind: "ROOM" | "EQUIPMENT";
  name: string;
  description: string | null;
  capacity: number | null;
  location: string | null;
  floor: string | null;
  features: string[];
  requiresApproval: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type BookingStatus = "CONFIRMED" | "PENDING" | "DECLINED" | "CANCELLED";

export interface BoardBooking {
  id: string;
  resourceId: string;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  isMine: boolean;
  title: string;
  bookedBy: string;
  eventId: string | null;
}

export interface ResourceBookingView {
  id: string;
  startsAt: string;
  endsAt: string;
  status: BookingStatus;
  attendeeCount: number | null;
  note: string | null;
  createdAt: string;
  resource: { id: string; name: string; kind: "ROOM" | "EQUIPMENT"; location: string | null; floor: string | null; capacity: number | null };
  event: { id: string; title: string };
  bookedBy: { name: string; email: string };
  isMine: boolean;
}

export type ResourceInput = {
  kind: "ROOM" | "EQUIPMENT";
  name: string;
  description?: string | null;
  capacity?: number | null;
  location?: string | null;
  floor?: string | null;
  features?: string[];
  requiresApproval?: boolean;
};

export function listResources(): Promise<CalendarResource[]> {
  return apiRequest<CalendarResource[]>("/calendar/resources");
}

export function createResource(input: ResourceInput): Promise<CalendarResource> {
  return apiRequest<CalendarResource>("/calendar/resources", { method: "POST", body: input });
}

export function updateResource(id: string, input: Partial<ResourceInput> & { isActive?: boolean }): Promise<CalendarResource> {
  return apiRequest<CalendarResource>(`/calendar/resources/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
}

export function resourceBoard(from: Date, to: Date): Promise<{ resources: CalendarResource[]; bookings: BoardBooking[] }> {
  const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  return apiRequest(`/calendar/resources/board?${query.toString()}`);
}

export function bookResource(
  resourceId: string,
  input: {
    title: string;
    startsAt: string;
    endsAt: string;
    timeZone: string;
    attendees?: string[];
    attendeeCount?: number;
    note?: string;
  }
): Promise<{ bookingId: string; eventId: string; status: BookingStatus }> {
  return apiRequest(`/calendar/resources/${encodeURIComponent(resourceId)}/book`, { method: "POST", body: input });
}

export function myBookings(): Promise<ResourceBookingView[]> {
  return apiRequest<ResourceBookingView[]>("/calendar/bookings/mine");
}

export function pendingBookings(): Promise<ResourceBookingView[]> {
  return apiRequest<ResourceBookingView[]>("/calendar/bookings/pending");
}

export function decideBooking(id: string, approve: boolean): Promise<ResourceBookingView[]> {
  return apiRequest<ResourceBookingView[]>(`/calendar/bookings/${encodeURIComponent(id)}/decision`, { method: "POST", body: { approve } });
}

export async function cancelBooking(id: string): Promise<void> {
  await apiRequest<null>(`/calendar/bookings/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}

// ── Scheduling links ────────────────────────────────────────────────────────

export type BookingLinkStatus = "DRAFT" | "PUBLISHED" | "PAUSED";
export type BookingLocationType = "VIDEO" | "PHONE" | "IN_PERSON";

export interface BookingLink {
  id: string;
  calendarId: string;
  slug: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  timeZone: string;
  weekdays: number[];
  dayStart: string;
  dayEnd: string;
  locationType: BookingLocationType;
  locationDetail: string | null;
  requiresApproval: boolean;
  status: BookingLinkStatus;
  createdAt: string;
  updatedAt: string;
  kind: "PERSONAL" | "TEAM";
  calendarName: string;
  owner: { name: string; email: string };
  isMine: boolean;
  pendingCount: number;
}

export type BookingLinkInput = Partial<
  Pick<
    BookingLink,
    | "title"
    | "description"
    | "calendarId"
    | "durationMinutes"
    | "bufferMinutes"
    | "minNoticeHours"
    | "maxDaysAhead"
    | "timeZone"
    | "weekdays"
    | "dayStart"
    | "dayEnd"
    | "locationType"
    | "locationDetail"
    | "requiresApproval"
    | "status"
  >
>;

export interface Slot {
  start: string;
  end: string;
}

export interface GuestBookingView {
  id: string;
  guestName: string;
  guestEmail: string;
  notes: string | null;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  status: "PENDING" | "CONFIRMED" | "DECLINED" | "CANCELLED";
  eventId: string | null;
  createdAt: string;
  link: { id: string; title: string; durationMinutes: number };
}

export interface PublicBookingPage {
  slug: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  timeZone: string;
  locationType: BookingLocationType;
  requiresApproval: boolean;
  maxDaysAhead: number;
  host: { name: string };
  workspace: { name: string };
  slots: Slot[];
}

export function listBookingLinks(): Promise<BookingLink[]> {
  return apiRequest<BookingLink[]>("/calendar/booking-links");
}

export function createBookingLink(input: BookingLinkInput & { title: string; timeZone: string }): Promise<BookingLink> {
  return apiRequest<BookingLink>("/calendar/booking-links", { method: "POST", body: input });
}

export function updateBookingLink(id: string, input: BookingLinkInput): Promise<BookingLink> {
  return apiRequest<BookingLink>(`/calendar/booking-links/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
}

export async function deleteBookingLink(id: string): Promise<void> {
  await apiRequest<null>(`/calendar/booking-links/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function bookingLinkSlots(id: string, from: Date, to: Date): Promise<Slot[]> {
  const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  return apiRequest<Slot[]>(`/calendar/booking-links/${encodeURIComponent(id)}/slots?${query.toString()}`);
}

export function listGuestBookings(): Promise<GuestBookingView[]> {
  return apiRequest<GuestBookingView[]>("/calendar/guest-bookings");
}

export function decideGuestBooking(id: string, approve: boolean): Promise<GuestBookingView[]> {
  return apiRequest<GuestBookingView[]>(`/calendar/guest-bookings/${encodeURIComponent(id)}/decision`, { method: "POST", body: { approve } });
}

export async function cancelGuestBooking(id: string): Promise<void> {
  await apiRequest<null>(`/calendar/guest-bookings/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}

/** The public page: no session is sent (guests are not signed in). */
export function getPublicBookingPage(slug: string, from: Date, to: Date): Promise<PublicBookingPage> {
  const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  return apiRequest<PublicBookingPage>(`/public/booking/${encodeURIComponent(slug)}?${query.toString()}`, { auth: false });
}

export function bookPublicSlot(
  slug: string,
  input: { name: string; email: string; startsAt: string; timeZone: string; notes?: string }
): Promise<{ id: string; status: "PENDING" | "CONFIRMED"; startsAt: string; endsAt: string; title: string; host: { name: string } }> {
  return apiRequest(`/public/booking/${encodeURIComponent(slug)}`, { method: "POST", body: input, auth: false });
}

// ── Meeting templates ───────────────────────────────────────────────────────

export type TemplateScope = "PERSONAL" | "TEAM";
export type TemplateStatus = "DRAFT" | "READY" | "PENDING_REVIEW";
export type ExternalGuestPolicy = "NOT_ALLOWED" | "APPROVAL" | "ALLOWED";

export interface MeetingTemplate {
  id: string;
  scope: TemplateScope;
  teamCalendarId: string | null;
  teamCalendar: { id: string; name: string; color: string } | null;
  title: string;
  agenda: string | null;
  durationMinutes: number;
  locationType: BookingLocationType;
  locationDetail: string | null;
  defaultAttendees: string[];
  bufferMinutes: number;
  minNoticeHours: number;
  externalGuests: ExternalGuestPolicy;
  recordingAllowed: boolean;
  status: TemplateStatus;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  owner: { name: string; email: string };
  isMine: boolean;
  canEdit: boolean;
  canReview: boolean;
}

export type TemplateInput = Partial<
  Pick<
    MeetingTemplate,
    | "title"
    | "agenda"
    | "durationMinutes"
    | "locationType"
    | "locationDetail"
    | "defaultAttendees"
    | "bufferMinutes"
    | "minNoticeHours"
    | "externalGuests"
    | "recordingAllowed"
  >
> & { status?: "DRAFT" | "READY" };

export function listTemplates(): Promise<MeetingTemplate[]> {
  return apiRequest<MeetingTemplate[]>("/calendar/templates");
}

export function createTemplate(input: TemplateInput & { title: string; scope?: TemplateScope; teamCalendarId?: string }): Promise<MeetingTemplate> {
  return apiRequest<MeetingTemplate>("/calendar/templates", { method: "POST", body: input });
}

export function updateTemplate(id: string, input: TemplateInput): Promise<MeetingTemplate> {
  return apiRequest<MeetingTemplate>(`/calendar/templates/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
}

export async function deleteTemplate(id: string): Promise<void> {
  await apiRequest<null>(`/calendar/templates/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function duplicateTemplate(id: string): Promise<MeetingTemplate> {
  return apiRequest<MeetingTemplate>(`/calendar/templates/${encodeURIComponent(id)}/duplicate`, { method: "POST" });
}

export function reviewTemplate(id: string, approve: boolean, note?: string): Promise<MeetingTemplate> {
  return apiRequest<MeetingTemplate>(`/calendar/templates/${encodeURIComponent(id)}/review`, { method: "POST", body: { approve, note } });
}

// ── Preferences ─────────────────────────────────────────────────────────────

export interface CalendarPreferences {
  defaultView: "day" | "week" | "month" | "agenda";
  /** 1 = Monday, 0 = Sunday, 6 = Saturday */
  weekStart: 0 | 1 | 6;
  defaultDurationMinutes: number;
  /** Null follows the device. */
  timeZone: string | null;
  locale: string;
  dateFormat: "DMY" | "MDY" | "YMD";
  timeFormat: "H24" | "H12";
  showWeekends: boolean;
  showDescriptions: boolean;
  workDays: number[];
  workStart: string;
  workEnd: string;
  defaultVisibility: "DEFAULT" | "PRIVATE";
  defaultShowAs: "BUSY" | "FREE";
  allowAccessRequests: boolean;
  showPendingInvitations: boolean;
  notifyInvitations: boolean;
  notifyResponses: boolean;
  notifyUpdates: boolean;
  notifyBookings: boolean;
  notifySharing: boolean;
  notifyTemplates: boolean;
  /** False until the member saves something (the defaults apply). */
  saved: boolean;
  updatedAt: string | null;
}

export type PreferencesInput = Partial<Omit<CalendarPreferences, "saved" | "updatedAt">>;

export const DEFAULT_CALENDAR_PREFERENCES: CalendarPreferences = {
  defaultView: "week",
  weekStart: 1,
  defaultDurationMinutes: 30,
  timeZone: null,
  locale: "en-GB",
  dateFormat: "DMY",
  timeFormat: "H24",
  showWeekends: false,
  showDescriptions: true,
  workDays: [1, 2, 3, 4, 5],
  workStart: "09:00",
  workEnd: "17:00",
  defaultVisibility: "DEFAULT",
  defaultShowAs: "BUSY",
  allowAccessRequests: true,
  showPendingInvitations: true,
  notifyInvitations: true,
  notifyResponses: true,
  notifyUpdates: true,
  notifyBookings: true,
  notifySharing: true,
  notifyTemplates: true,
  saved: false,
  updatedAt: null,
};

export async function getPreferences(): Promise<CalendarPreferences> {
  const data = await apiRequest<Partial<CalendarPreferences>>("/calendar/preferences");
  // Anything missing or malformed falls back to the defaults.
  const valid = data && typeof data === "object" && !Array.isArray(data) && "defaultView" in data;
  return { ...DEFAULT_CALENDAR_PREFERENCES, ...(valid ? data : {}) };
}

export function updatePreferences(input: PreferencesInput): Promise<CalendarPreferences> {
  return apiRequest<CalendarPreferences>("/calendar/preferences", { method: "PATCH", body: input });
}
