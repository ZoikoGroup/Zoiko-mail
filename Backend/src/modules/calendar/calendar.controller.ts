import type { Request, Response } from "express";
import { asyncHandler } from "../../common/middleware/asyncHandler.js";
import { sendSuccess } from "../../common/utils/response.js";
import { calendarService, type CalendarContext } from "./calendar.service.js";
import { slotRangeSchema, resourceBoardSchema, freeBusySchema, listEventsSchema, listInvitationsSchema, peopleSchema, scopedEventsSchema } from "./calendar.schema.js";
import { sharingService } from "./sharing.service.js";
import { resourceService } from "./resource.service.js";
import { bookingLinkService } from "./booking-link.service.js";
import { invitationService } from "./invitation.service.js";
import { templateService } from "./template.service.js";
import { preferenceService } from "./preference.service.js";

function context(req: Request): CalendarContext {
  const tenant = req.tenantContext!;
  return {
    tenantId: tenant.tenantId,
    userId: tenant.userId,
    membershipId: tenant.membershipId,
    membershipRole: tenant.membershipRole,
    requestId: req.requestId,
  };
}

export const listCalendars = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await calendarService.listCalendars(context(req)), req.requestId);
});

export const createCalendar = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await calendarService.createCalendar(req.body, context(req)), req.requestId);
});

export const updateCalendar = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(
    res,
    200,
    await calendarService.updateCalendar(String(req.params.calendarId), req.body, context(req)),
    req.requestId
  );
});

export const deleteCalendar = asyncHandler(async (req: Request, res: Response) => {
  await calendarService.deleteCalendar(String(req.params.calendarId), context(req));
  sendSuccess(res, 204, null, req.requestId);
});

export const listEvents = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await calendarService.listEvents(listEventsSchema.parse(req.query), context(req)), req.requestId);
});

export const getEvent = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await calendarService.getEvent(String(req.params.eventId), context(req)), req.requestId);
});

export const createEvent = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await calendarService.createEvent(req.body, context(req)), req.requestId);
});

export const updateEvent = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(
    res,
    200,
    await calendarService.updateEvent(String(req.params.eventId), req.body, context(req)),
    req.requestId
  );
});

export const deleteEvent = asyncHandler(async (req: Request, res: Response) => {
  await calendarService.deleteEvent(String(req.params.eventId), context(req));
  sendSuccess(res, 204, null, req.requestId);
});

// ── Invitations ─────────────────────────────────────────────────────────────

export const listInvitations = asyncHandler(async (req: Request, res: Response) => {
  const { tab, q } = listInvitationsSchema.parse(req.query);
  sendSuccess(res, 200, await invitationService.list(tab, q, context(req)), req.requestId);
});

export const invitationCounts = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await invitationService.counts(context(req)), req.requestId);
});

export const people = asyncHandler(async (req: Request, res: Response) => {
  const { q } = peopleSchema.parse(req.query);
  sendSuccess(res, 200, await invitationService.people(q, context(req)), req.requestId);
});

export const eventDetails = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await invitationService.detail(String(req.params.eventId), context(req)), req.requestId);
});

export const markSeen = asyncHandler(async (req: Request, res: Response) => {
  await invitationService.markSeen(String(req.params.eventId), context(req));
  sendSuccess(res, 204, null, req.requestId);
});

export const respond = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await invitationService.respond(String(req.params.eventId), req.body, context(req)), req.requestId);
});

export const proposeTime = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await invitationService.proposeTime(String(req.params.eventId), req.body, context(req)), req.requestId);
});

// ── Sharing, team calendars, free/busy ──────────────────────────────────────

export const accessibleCalendars = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await sharingService.accessibleCalendars(context(req)), req.requestId);
});

export const createTeamCalendar = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await calendarService.createTeamCalendar(req.body, context(req)), req.requestId);
});

export const scopedEvents = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await sharingService.scopedEvents(scopedEventsSchema.parse(req.query), context(req)), req.requestId);
});

export const listShares = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await sharingService.listShares(String(req.params.calendarId), context(req)), req.requestId);
});

export const share = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await sharingService.share(String(req.params.calendarId), req.body, context(req)), req.requestId);
});

export const removeShare = asyncHandler(async (req: Request, res: Response) => {
  await sharingService.removeShare(String(req.params.calendarId), String(req.params.shareId), context(req));
  sendSuccess(res, 204, null, req.requestId);
});

export const requestAccess = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await sharingService.requestAccess(req.body, context(req)), req.requestId);
});

export const listAccessRequests = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await sharingService.listAccessRequests(context(req)), req.requestId);
});

export const decideAccessRequest = asyncHandler(async (req: Request, res: Response) => {
  const { approve, access } = req.body as { approve: boolean; access?: "FREE_BUSY" | "VIEW" | "EDIT" | "MANAGE" };
  sendSuccess(res, 200, await sharingService.decide(String(req.params.requestId), approve, context(req), access), req.requestId);
});

export const freeBusy = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await sharingService.freeBusy(freeBusySchema.parse(req.query), context(req)), req.requestId);
});

export const findTime = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await sharingService.findTime(req.body, context(req)), req.requestId);
});

// ── Rooms and resources ─────────────────────────────────────────────────────

export const listResources = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await resourceService.list(context(req)), req.requestId);
});

export const createResource = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await resourceService.create(req.body, context(req)), req.requestId);
});

export const updateResource = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await resourceService.update(String(req.params.resourceId), req.body, context(req)), req.requestId);
});

export const resourceBoard = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await resourceService.board(resourceBoardSchema.parse(req.query), context(req)), req.requestId);
});

export const bookResource = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await resourceService.book(String(req.params.resourceId), req.body, context(req)), req.requestId);
});

export const addResourceToEvent = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await resourceService.addToEvent(String(req.params.eventId), req.body.resourceId, context(req)), req.requestId);
});

export const myBookings = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await resourceService.mine(context(req)), req.requestId);
});

export const pendingBookings = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await resourceService.pending(context(req)), req.requestId);
});

export const decideBooking = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await resourceService.decide(String(req.params.bookingId), req.body.approve, context(req)), req.requestId);
});

export const cancelBooking = asyncHandler(async (req: Request, res: Response) => {
  await resourceService.cancel(String(req.params.bookingId), context(req));
  sendSuccess(res, 204, null, req.requestId);
});

// ── Scheduling links ────────────────────────────────────────────────────────

export const listBookingLinks = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await bookingLinkService.list(context(req)), req.requestId);
});

export const createBookingLink = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await bookingLinkService.create(req.body, context(req)), req.requestId);
});

export const updateBookingLink = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await bookingLinkService.update(String(req.params.linkId), req.body, context(req)), req.requestId);
});

export const deleteBookingLink = asyncHandler(async (req: Request, res: Response) => {
  await bookingLinkService.remove(String(req.params.linkId), context(req));
  sendSuccess(res, 204, null, req.requestId);
});

export const previewSlots = asyncHandler(async (req: Request, res: Response) => {
  const { from, to } = slotRangeSchema.parse(req.query);
  sendSuccess(res, 200, await bookingLinkService.previewSlots(String(req.params.linkId), from, to, context(req)), req.requestId);
});

export const guestBookingRequests = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await bookingLinkService.requests(context(req)), req.requestId);
});

export const decideGuestBooking = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await bookingLinkService.decide(String(req.params.guestBookingId), req.body.approve, context(req)), req.requestId);
});

export const cancelGuestBooking = asyncHandler(async (req: Request, res: Response) => {
  await bookingLinkService.cancel(String(req.params.guestBookingId), context(req));
  sendSuccess(res, 204, null, req.requestId);
});

export const listTemplates = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await templateService.list(context(req)), req.requestId);
});

export const createTemplate = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await templateService.create(req.body, context(req)), req.requestId);
});

export const updateTemplate = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await templateService.update(String(req.params.templateId), req.body, context(req)), req.requestId);
});

export const deleteTemplate = asyncHandler(async (req: Request, res: Response) => {
  await templateService.remove(String(req.params.templateId), context(req));
  sendSuccess(res, 204, null, req.requestId);
});

export const duplicateTemplate = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 201, await templateService.duplicate(String(req.params.templateId), context(req)), req.requestId);
});

export const reviewTemplate = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await templateService.review(String(req.params.templateId), req.body.approve, req.body.note, context(req)), req.requestId);
});

export const getPreferences = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await preferenceService.get(context(req)), req.requestId);
});

export const updatePreferences = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, 200, await preferenceService.update(req.body, context(req)), req.requestId);
});
