import { Router } from "express";
import { validate } from "../../common/middleware/validate.js";
import {
  calendarIdParamsSchema,
  preferencesSchema,
  templateSchema,
  updateTemplateSchema,
  templateIdParamsSchema,
  reviewTemplateSchema,
  createCalendarSchema,
  createEventSchema,
  bookingLinkSchema,
  decideGuestBookingSchema,
  guestBookingIdParamsSchema,
  linkIdParamsSchema,
  slotRangeSchema,
  updateBookingLinkSchema,
  addResourceSchema,
  bookResourceSchema,
  bookingIdParamsSchema,
  decideBookingSchema,
  resourceBoardSchema,
  resourceIdParamsSchema,
  resourceSchema,
  updateResourceSchema,
  createTeamCalendarSchema,
  decideRequestSchema,
  findTimeSchema,
  freeBusySchema,
  requestAccessSchema,
  requestIdParamsSchema,
  scopedEventsSchema,
  shareParamsSchema,
  shareSchema,
  eventIdParamsSchema,
  listEventsSchema,
  listInvitationsSchema,
  peopleSchema,
  proposeTimeSchema,
  respondSchema,
  updateCalendarSchema,
  updateEventSchema,
} from "./calendar.schema.js";
import * as controller from "./calendar.controller.js";

/**
 * A member's own calendars and events. Mounted behind authenticate and
 * tenantContext (routes/index.ts): every route acts on the caller's own
 * calendars, so no capability beyond an active membership is needed — another
 * member's calendar or event answers 404, as if it did not exist.
 */
export const calendarRouter = Router();

calendarRouter.get("/calendars", controller.listCalendars);
calendarRouter.post("/calendars", validate(createCalendarSchema), controller.createCalendar);
calendarRouter.patch(
  "/calendars/:calendarId",
  validate(calendarIdParamsSchema, "params"),
  validate(updateCalendarSchema),
  controller.updateCalendar
);
calendarRouter.delete("/calendars/:calendarId", validate(calendarIdParamsSchema, "params"), controller.deleteCalendar);

calendarRouter.get("/events", validate(listEventsSchema, "query"), controller.listEvents);
calendarRouter.post("/events", validate(createEventSchema), controller.createEvent);
calendarRouter.get("/events/:eventId", validate(eventIdParamsSchema, "params"), controller.getEvent);
calendarRouter.patch(
  "/events/:eventId",
  validate(eventIdParamsSchema, "params"),
  validate(updateEventSchema),
  controller.updateEvent
);
calendarRouter.delete("/events/:eventId", validate(eventIdParamsSchema, "params"), controller.deleteEvent);

// Invitations. The event routes below answer for the organizer or an attendee;
// anyone else gets 404.
calendarRouter.get("/invitations", validate(listInvitationsSchema, "query"), controller.listInvitations);
calendarRouter.get("/invitations/counts", controller.invitationCounts);
calendarRouter.get("/people", validate(peopleSchema, "query"), controller.people);
calendarRouter.get("/events/:eventId/details", validate(eventIdParamsSchema, "params"), controller.eventDetails);
calendarRouter.post("/events/:eventId/seen", validate(eventIdParamsSchema, "params"), controller.markSeen);
calendarRouter.post(
  "/events/:eventId/respond",
  validate(eventIdParamsSchema, "params"),
  validate(respondSchema),
  controller.respond
);
calendarRouter.post(
  "/events/:eventId/propose",
  validate(eventIdParamsSchema, "params"),
  validate(proposeTimeSchema),
  controller.proposeTime
);

// Sharing and team calendars. A calendar the caller has no access to answers
// 404; one they can see but not change in that way answers 403.
calendarRouter.get("/accessible", controller.accessibleCalendars);
calendarRouter.post("/team-calendars", validate(createTeamCalendarSchema), controller.createTeamCalendar);
calendarRouter.get("/scoped-events", validate(scopedEventsSchema, "query"), controller.scopedEvents);
calendarRouter.get("/calendars/:calendarId/shares", validate(calendarIdParamsSchema, "params"), controller.listShares);
calendarRouter.post(
  "/calendars/:calendarId/shares",
  validate(calendarIdParamsSchema, "params"),
  validate(shareSchema),
  controller.share
);
calendarRouter.delete("/calendars/:calendarId/shares/:shareId", validate(shareParamsSchema, "params"), controller.removeShare);
calendarRouter.get("/access-requests", controller.listAccessRequests);
calendarRouter.post("/access-requests", validate(requestAccessSchema), controller.requestAccess);
calendarRouter.post(
  "/access-requests/:requestId/decision",
  validate(requestIdParamsSchema, "params"),
  validate(decideRequestSchema),
  controller.decideAccessRequest
);

// Free/busy is workspace-wide: times only, never what the time is taken by.
calendarRouter.get("/freebusy", validate(freeBusySchema, "query"), controller.freeBusy);
calendarRouter.post("/find-time", validate(findTimeSchema), controller.findTime);

// Rooms and resources. Owners and Admins manage them and decide on bookings
// that need approval (checked in the service); any member books.
calendarRouter.get("/resources", controller.listResources);
calendarRouter.post("/resources", validate(resourceSchema), controller.createResource);
calendarRouter.get("/resources/board", validate(resourceBoardSchema, "query"), controller.resourceBoard);
calendarRouter.patch(
  "/resources/:resourceId",
  validate(resourceIdParamsSchema, "params"),
  validate(updateResourceSchema),
  controller.updateResource
);
calendarRouter.post(
  "/resources/:resourceId/book",
  validate(resourceIdParamsSchema, "params"),
  validate(bookResourceSchema),
  controller.bookResource
);
calendarRouter.post(
  "/events/:eventId/resources",
  validate(eventIdParamsSchema, "params"),
  validate(addResourceSchema),
  controller.addResourceToEvent
);
calendarRouter.get("/bookings/mine", controller.myBookings);
calendarRouter.get("/bookings/pending", controller.pendingBookings);
calendarRouter.post(
  "/bookings/:bookingId/decision",
  validate(bookingIdParamsSchema, "params"),
  validate(decideBookingSchema),
  controller.decideBooking
);
calendarRouter.post("/bookings/:bookingId/cancel", validate(bookingIdParamsSchema, "params"), controller.cancelBooking);

// Scheduling links (the owner's side). The public booking page is mounted
// separately, without sign-in (booking-public.routes.ts).
calendarRouter.get("/booking-links", controller.listBookingLinks);
calendarRouter.post("/booking-links", validate(bookingLinkSchema), controller.createBookingLink);
calendarRouter.patch(
  "/booking-links/:linkId",
  validate(linkIdParamsSchema, "params"),
  validate(updateBookingLinkSchema),
  controller.updateBookingLink
);
calendarRouter.delete("/booking-links/:linkId", validate(linkIdParamsSchema, "params"), controller.deleteBookingLink);
calendarRouter.get(
  "/booking-links/:linkId/slots",
  validate(linkIdParamsSchema, "params"),
  validate(slotRangeSchema, "query"),
  controller.previewSlots
);
calendarRouter.get("/guest-bookings", controller.guestBookingRequests);
calendarRouter.post(
  "/guest-bookings/:guestBookingId/decision",
  validate(guestBookingIdParamsSchema, "params"),
  validate(decideGuestBookingSchema),
  controller.decideGuestBooking
);
calendarRouter.post("/guest-bookings/:guestBookingId/cancel", validate(guestBookingIdParamsSchema, "params"), controller.cancelGuestBooking);

// Meeting templates: personal ones, and team ones with a review queue.
calendarRouter.get("/templates", controller.listTemplates);
calendarRouter.post("/templates", validate(templateSchema), controller.createTemplate);
calendarRouter.patch(
  "/templates/:templateId",
  validate(templateIdParamsSchema, "params"),
  validate(updateTemplateSchema),
  controller.updateTemplate
);
calendarRouter.delete("/templates/:templateId", validate(templateIdParamsSchema, "params"), controller.deleteTemplate);
calendarRouter.post("/templates/:templateId/duplicate", validate(templateIdParamsSchema, "params"), controller.duplicateTemplate);
calendarRouter.post(
  "/templates/:templateId/review",
  validate(templateIdParamsSchema, "params"),
  validate(reviewTemplateSchema),
  controller.reviewTemplate
);

// The member's own calendar preferences.
calendarRouter.get("/preferences", controller.getPreferences);
calendarRouter.patch("/preferences", validate(preferencesSchema), controller.updatePreferences);
