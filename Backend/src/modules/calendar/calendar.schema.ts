import { z } from "zod";

/** The palette a calendar can be shown in. Keys, not colours: the client renders them per theme. */
export const CALENDAR_COLORS = ["blue", "green", "purple", "amber", "teal", "red", "slate"] as const;

/** The longest span one list request may cover (a month view with its overflow weeks). */
export const MAX_RANGE_DAYS = 62;

const name = z.string().trim().min(1, "Give it a name").max(80);
const color = z.enum(CALENDAR_COLORS);

// ── Calendars ───────────────────────────────────────────────────────────────
export const createCalendarSchema = z
  .object({
    name,
    color: color.default("blue"),
    description: z.string().trim().max(500).optional(),
  })
  .strict();
export type CreateCalendarInput = z.infer<typeof createCalendarSchema>;

export const updateCalendarSchema = z
  .object({
    name: name.optional(),
    color: color.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    isVisible: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });
export type UpdateCalendarInput = z.infer<typeof updateCalendarSchema>;

export const calendarIdParamsSchema = z.object({ calendarId: z.string().uuid() });

// ── Events ──────────────────────────────────────────────────────────────────
const eventFields = {
  calendarId: z.string().uuid(),
  title: z.string().trim().min(1, "Give the event a title").max(200),
  description: z.string().trim().max(5000).nullable().optional(),
  location: z.string().trim().max(300).nullable().optional(),
  videoLink: z.string().trim().url("Enter a full link, starting with https://").max(2048).nullable().optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  allDay: z.boolean().default(false),
  timeZone: z.string().trim().min(1).max(64).default("UTC"),
  visibility: z.enum(["DEFAULT", "PRIVATE"]).default("DEFAULT"),
  showAs: z.enum(["BUSY", "FREE"]).default("BUSY"),
  /** Addresses to invite. Members of the workspace answer in Zoiko; others are guests. */
  attendees: z.array(z.string().trim().toLowerCase().email("Enter a valid email address").max(254)).max(100).optional(),
};

export const createEventSchema = z.object(eventFields).strict();
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = z
  .object({
    calendarId: eventFields.calendarId.optional(),
    title: eventFields.title.optional(),
    description: eventFields.description,
    location: eventFields.location,
    videoLink: eventFields.videoLink,
    startsAt: eventFields.startsAt.optional(),
    endsAt: eventFields.endsAt.optional(),
    allDay: z.boolean().optional(),
    timeZone: z.string().trim().min(1).max(64).optional(),
    visibility: z.enum(["DEFAULT", "PRIVATE"]).optional(),
    showAs: z.enum(["BUSY", "FREE"]).optional(),
    /** The full list after the change: missing addresses are uninvited. */
    attendees: eventFields.attendees,
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const listEventsSchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .refine((v) => v.to > v.from, { message: "to must be after from", path: ["to"] })
  .refine((v) => v.to.getTime() - v.from.getTime() <= MAX_RANGE_DAYS * 86_400_000, {
    message: `Ask for at most ${MAX_RANGE_DAYS} days at a time`,
    path: ["to"],
  });
export type ListEventsInput = z.infer<typeof listEventsSchema>;

export const eventIdParamsSchema = z.object({ eventId: z.string().uuid() });

// ── Invitations ─────────────────────────────────────────────────────────────
export const INVITATION_TABS = ["awaiting", "all", "updates", "accepted", "sent"] as const;
export type InvitationTab = (typeof INVITATION_TABS)[number];

export const listInvitationsSchema = z.object({
  tab: z.enum(INVITATION_TABS).default("awaiting"),
  q: z.string().trim().min(1).max(200).optional(),
});

export const respondSchema = z
  .object({
    response: z.enum(["ACCEPTED", "TENTATIVE", "DECLINED"]),
    comment: z.string().trim().max(500).optional(),
  })
  .strict();
export type RespondInput = z.infer<typeof respondSchema>;

export const proposeTimeSchema = z
  .object({
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    comment: z.string().trim().max(500).optional(),
  })
  .strict();
export type ProposeTimeInput = z.infer<typeof proposeTimeSchema>;

export const peopleSchema = z.object({ q: z.string().trim().max(200).default("") });

// ── Sharing, team calendars, free/busy ──────────────────────────────────────
export const CALENDAR_ACCESS = ["FREE_BUSY", "VIEW", "EDIT", "MANAGE"] as const;

const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);

export const createTeamCalendarSchema = z
  .object({
    name,
    color: color.default("purple"),
    description: z.string().trim().max(500).optional(),
    /** Colleagues who join it. They can add and change events. */
    members: z.array(email).max(100).default([]),
  })
  .strict();
export type CreateTeamCalendarInput = z.infer<typeof createTeamCalendarSchema>;

export const shareSchema = z.object({ email, access: z.enum(CALENDAR_ACCESS) }).strict();
export type ShareInput = z.infer<typeof shareSchema>;

export const shareParamsSchema = z.object({ calendarId: z.string().uuid(), shareId: z.string().uuid() });

export const requestAccessSchema = z
  .object({
    /** A calendar the caller can already see something of… */
    calendarId: z.string().uuid().optional(),
    /** …or a colleague, whose main calendar is meant. */
    ownerEmail: email.optional(),
    access: z.enum(CALENDAR_ACCESS),
    message: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.calendarId) !== Boolean(v.ownerEmail), {
    message: "Name either a calendar or a colleague",
    path: ["calendarId"],
  });
export type RequestAccessInput = z.infer<typeof requestAccessSchema>;

export const decideRequestSchema = z
  .object({ approve: z.boolean(), access: z.enum(CALENDAR_ACCESS).optional() })
  .strict();

export const requestIdParamsSchema = z.object({ requestId: z.string().uuid() });

export const scopedEventsSchema = z
  .object({ scope: z.enum(["team", "shared"]), from: z.coerce.date(), to: z.coerce.date() })
  .refine((v) => v.to > v.from, { message: "to must be after from", path: ["to"] })
  .refine((v) => v.to.getTime() - v.from.getTime() <= MAX_RANGE_DAYS * 86_400_000, {
    message: `Ask for at most ${MAX_RANGE_DAYS} days at a time`,
    path: ["to"],
  });
export type ScopedEventsInput = z.infer<typeof scopedEventsSchema>;

/** Query strings carry the people as one comma-separated list. */
const emailList = z.preprocess(
  (v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : v),
  z.array(email).max(50)
);

export const freeBusySchema = z
  .object({
    emails: emailList.default([]),
    from: z.coerce.date(),
    to: z.coerce.date(),
    includeMe: z.preprocess((v) => v === true || v === "true", z.boolean()).default(false),
  })
  .refine((v) => v.to > v.from, { message: "to must be after from", path: ["to"] });
export type FreeBusyInput = z.infer<typeof freeBusySchema>;

export const findTimeSchema = z
  .object({
    emails: z.array(email).min(1, "Add at least one person").max(50),
    from: z.coerce.date(),
    to: z.coerce.date(),
    durationMinutes: z.number().int().min(15).max(480),
    timeZone: z.string().trim().min(1).max(64).default("UTC"),
    dayStartHour: z.number().int().min(0).max(23).default(9),
    dayEndHour: z.number().int().min(1).max(24).default(17),
    limit: z.number().int().min(1).max(20).default(6),
  })
  .strict()
  .refine((v) => v.to > v.from, { message: "to must be after from", path: ["to"] })
  .refine((v) => v.dayEndHour > v.dayStartHour, { message: "The working day must end after it starts", path: ["dayEndHour"] })
  .refine((v) => v.to.getTime() - v.from.getTime() <= 31 * 86_400_000, { message: "Look at most 31 days ahead", path: ["to"] });
export type FindTimeInput = z.infer<typeof findTimeSchema>;

// ── Rooms and resources ─────────────────────────────────────────────────────

const resourceFields = {
  kind: z.enum(["ROOM", "EQUIPMENT"]).default("ROOM"),
  name: z.string().trim().min(1, "Give it a name").max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  capacity: z.number().int().min(1).max(5000).nullable().optional(),
  location: z.string().trim().max(120).nullable().optional(),
  floor: z.string().trim().max(60).nullable().optional(),
  features: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  requiresApproval: z.boolean().default(false),
};

export const resourceSchema = z.object(resourceFields).strict();
export type ResourceInput = z.infer<typeof resourceSchema>;

export const updateResourceSchema = z
  .object({
    kind: resourceFields.kind.optional(),
    name: resourceFields.name.optional(),
    description: resourceFields.description,
    capacity: resourceFields.capacity,
    location: resourceFields.location,
    floor: resourceFields.floor,
    features: resourceFields.features,
    requiresApproval: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });
export type UpdateResourceInput = z.infer<typeof updateResourceSchema>;

export const resourceIdParamsSchema = z.object({ resourceId: z.string().uuid() });
export const bookingIdParamsSchema = z.object({ bookingId: z.string().uuid() });

export const resourceBoardSchema = z
  .object({ from: z.coerce.date(), to: z.coerce.date() })
  .refine((v) => v.to > v.from, { message: "to must be after from", path: ["to"] })
  .refine((v) => v.to.getTime() - v.from.getTime() <= 14 * 86_400_000, { message: "Ask for at most 14 days at a time", path: ["to"] });
export type ResourceBoardInput = z.infer<typeof resourceBoardSchema>;

export const bookResourceSchema = z
  .object({
    title: z.string().trim().min(1, "Give the meeting a title").max(200),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    timeZone: z.string().trim().min(1).max(64).default("UTC"),
    /** Which of my calendars the meeting goes in. Defaults to the main one. */
    calendarId: z.string().uuid().optional(),
    attendees: z.array(z.string().trim().toLowerCase().email("Enter a valid email address").max(254)).max(100).optional(),
    attendeeCount: z.number().int().min(1).max(5000).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
export type BookResourceInput = z.infer<typeof bookResourceSchema>;

export const addResourceSchema = z.object({ resourceId: z.string().uuid() }).strict();
export const decideBookingSchema = z.object({ approve: z.boolean() }).strict();

// ── Scheduling links ────────────────────────────────────────────────────────

const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

const bookingLinkFields = {
  title: z.string().trim().min(1, "Give the link a title").max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  /** Which of the caller's calendars (or a team calendar they can edit) bookings go in. */
  calendarId: z.string().uuid().optional(),
  durationMinutes: z.number().int().min(15).max(240).default(30),
  bufferMinutes: z.number().int().min(0).max(120).default(0),
  minNoticeHours: z.number().int().min(0).max(720).default(12),
  maxDaysAhead: z.number().int().min(1).max(365).default(30),
  timeZone: z.string().trim().min(1).max(64),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1, "Choose at least one day").max(7).default([1, 2, 3, 4, 5]),
  dayStart: hm.default("09:00"),
  dayEnd: hm.default("17:00"),
  locationType: z.enum(["VIDEO", "PHONE", "IN_PERSON"]).default("VIDEO"),
  locationDetail: z.string().trim().max(500).nullable().optional(),
  requiresApproval: z.boolean().default(false),
  status: z.enum(["DRAFT", "PUBLISHED", "PAUSED"]).default("DRAFT"),
};

export const bookingLinkSchema = z
  .object(bookingLinkFields)
  .strict()
  .refine((v) => v.dayStart < v.dayEnd, { message: "The day must end after it starts", path: ["dayEnd"] });
export type BookingLinkInput = z.infer<typeof bookingLinkSchema>;

export const updateBookingLinkSchema = z
  .object({
    title: bookingLinkFields.title.optional(),
    description: bookingLinkFields.description,
    calendarId: z.string().uuid().optional(),
    durationMinutes: z.number().int().min(15).max(240).optional(),
    bufferMinutes: z.number().int().min(0).max(120).optional(),
    minNoticeHours: z.number().int().min(0).max(720).optional(),
    maxDaysAhead: z.number().int().min(1).max(365).optional(),
    timeZone: z.string().trim().min(1).max(64).optional(),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1, "Choose at least one day").max(7).optional(),
    dayStart: hm.optional(),
    dayEnd: hm.optional(),
    locationType: z.enum(["VIDEO", "PHONE", "IN_PERSON"]).optional(),
    locationDetail: bookingLinkFields.locationDetail,
    requiresApproval: z.boolean().optional(),
    status: z.enum(["DRAFT", "PUBLISHED", "PAUSED"]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });
export type UpdateBookingLinkInput = z.infer<typeof updateBookingLinkSchema>;

export const linkIdParamsSchema = z.object({ linkId: z.string().uuid() });
export const guestBookingIdParamsSchema = z.object({ guestBookingId: z.string().uuid() });
export const slugParamsSchema = z.object({ slug: z.string().trim().min(3).max(80).regex(/^[a-z0-9-]+$/) });

export const slotRangeSchema = z
  .object({ from: z.coerce.date(), to: z.coerce.date() })
  .refine((v) => v.to > v.from, { message: "to must be after from", path: ["to"] })
  .refine((v) => v.to.getTime() - v.from.getTime() <= 45 * 86_400_000, { message: "Ask for at most 45 days at a time", path: ["to"] });

export const guestBookSchema = z
  .object({
    name: z.string().trim().min(1, "Enter your name").max(120),
    email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
    startsAt: z.coerce.date(),
    timeZone: z.string().trim().min(1).max(64).default("UTC"),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();
export type GuestBookInput = z.infer<typeof guestBookSchema>;

export const decideGuestBookingSchema = z.object({ approve: z.boolean() }).strict();

// ── Meeting templates ───────────────────────────────────────────────────────

const templateFields = {
  title: z.string().trim().min(1, "Give the template a title").max(120),
  agenda: z.string().trim().max(4000).nullable().optional(),
  durationMinutes: z.number().int().min(5).max(480).default(30),
  locationType: z.enum(["VIDEO", "PHONE", "IN_PERSON"]).default("VIDEO"),
  locationDetail: z.string().trim().max(500).nullable().optional(),
  defaultAttendees: z.array(email).max(50).default([]),
  bufferMinutes: z.number().int().min(0).max(120).default(0),
  minNoticeHours: z.number().int().min(0).max(720).default(0),
  externalGuests: z.enum(["NOT_ALLOWED", "APPROVAL", "ALLOWED"]).default("APPROVAL"),
  recordingAllowed: z.boolean().default(false),
  /** READY on a team template from a non-manager becomes PENDING_REVIEW. */
  status: z.enum(["DRAFT", "READY"]).default("READY"),
};

export const templateSchema = z
  .object({
    ...templateFields,
    scope: z.enum(["PERSONAL", "TEAM"]).default("PERSONAL"),
    teamCalendarId: z.string().uuid().optional(),
  })
  .strict();
export type TemplateInput = z.infer<typeof templateSchema>;

export const updateTemplateSchema = z
  .object({
    title: templateFields.title.optional(),
    agenda: templateFields.agenda,
    durationMinutes: z.number().int().min(5).max(480).optional(),
    locationType: z.enum(["VIDEO", "PHONE", "IN_PERSON"]).optional(),
    locationDetail: templateFields.locationDetail,
    defaultAttendees: z.array(email).max(50).optional(),
    bufferMinutes: z.number().int().min(0).max(120).optional(),
    minNoticeHours: z.number().int().min(0).max(720).optional(),
    externalGuests: z.enum(["NOT_ALLOWED", "APPROVAL", "ALLOWED"]).optional(),
    recordingAllowed: z.boolean().optional(),
    status: z.enum(["DRAFT", "READY"]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

export const templateIdParamsSchema = z.object({ templateId: z.string().uuid() });
export const reviewTemplateSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional() }).strict();

// ── Preferences ─────────────────────────────────────────────────────────────

export const preferencesSchema = z
  .object({
    defaultView: z.enum(["day", "week", "month", "agenda"]),
    weekStart: z.union([z.literal(0), z.literal(1), z.literal(6)]),
    defaultDurationMinutes: z.number().int().min(5).max(480),
    /** null follows the device's zone. */
    timeZone: z.string().trim().min(1).max(64).nullable(),
    locale: z.enum(["en-GB", "en-US", "en-IN", "fr-FR", "de-DE", "es-ES"]),
    dateFormat: z.enum(["DMY", "MDY", "YMD"]),
    timeFormat: z.enum(["H24", "H12"]),
    showWeekends: z.boolean(),
    showDescriptions: z.boolean(),
    workDays: z.array(z.number().int().min(1).max(7)).min(1, "Choose at least one working day").max(7),
    workStart: hm,
    workEnd: hm,
    defaultVisibility: z.enum(["DEFAULT", "PRIVATE"]),
    defaultShowAs: z.enum(["BUSY", "FREE"]),
    allowAccessRequests: z.boolean(),
    showPendingInvitations: z.boolean(),
    notifyInvitations: z.boolean(),
    notifyResponses: z.boolean(),
    notifyUpdates: z.boolean(),
    notifyBookings: z.boolean(),
    notifySharing: z.boolean(),
    notifyTemplates: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });
export type PreferencesInput = z.infer<typeof preferencesSchema>;
