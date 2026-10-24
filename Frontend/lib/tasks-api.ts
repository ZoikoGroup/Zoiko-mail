import { apiRequest } from "./api-client";
import type { ActionPriority, ActionStatus } from "./actions-api";

/**
 * Tasks — the Tasks section of the webmail (GET /tasks and friends). A task
 * is a commitment on the server, so the inbox's ActionInbox and these pages
 * read the same records.
 */

export type TaskPriority = ActionPriority;
export type TaskStatus = ActionStatus;
/** Statuses set directly; completing and reopening have their own calls. */
export type EditableTaskStatus = "OPEN" | "PLANNED" | "IN_PROGRESS";
export type TaskDueState = "overdue" | "today" | "upcoming" | "none";
export type TaskView = "all" | "today" | "upcoming" | "overdue" | "completed" | "from_email" | "assigned";
export type TaskSort = "due_asc" | "due_desc" | "priority" | "created_desc" | "completed_desc";

export interface TaskUser {
  id: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
}

export interface TaskChecklistItem {
  id: string;
  text: string;
  done: boolean;
  position: number;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  /** The first due date, once a task has been rescheduled. */
  originalDueAt: string | null;
  snoozedUntil: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Relative to today in the zone the list was asked for. */
  dueState: TaskDueState;
  daysOverdue: number;
  messageId: string | null;
  threadId: string | null;
  hasLinkedEmail: boolean;
  /** Somebody other than the owner created it. */
  isAssigned: boolean;
  fromAi: boolean;
  owner: TaskUser;
  createdBy: TaskUser;
  completedBy: TaskUser | null;
  checklist: TaskChecklistItem[];
  checklistProgress: { done: number; total: number };
}

export type LinkedEmail =
  | {
      accessible: true;
      messageId: string;
      threadId: string | null;
      subject: string;
      fromName: string | null;
      fromAddress: string | null;
      sentAt: string;
      folder: string | null;
    }
  | { accessible: false; messageId: string | null; threadId: string | null };

export interface TaskDetail extends Task {
  linkedEmail: LinkedEmail | null;
}

export interface TaskPage {
  items: Task[];
  nextCursor: string | null;
  timeZone: string;
}

export interface TaskSummary {
  timeZone: string;
  /** Today's local date, "YYYY-MM-DD". */
  today: string;
  counts: {
    open: number;
    overdue: number;
    dueToday: number;
    next7Days: number;
    upcoming: number;
    fromEmail: number;
    assigned: number;
    completedThisWeek: number;
  };
}

export interface ListTasksParams {
  view: TaskView;
  q?: string;
  priority?: TaskPriority;
  sort?: TaskSort;
  /** Upcoming: days ahead. Completed: days back. */
  days?: number;
  limit?: number;
  cursor?: string;
}

export interface TaskInput {
  title: string;
  description?: string | null;
  dueAt?: string | null;
  priority?: TaskPriority;
  status?: EditableTaskStatus;
  messageId?: string;
  threadId?: string;
  checklist?: string[];
}

export type TaskUpdate = Partial<Pick<TaskInput, "title" | "description" | "dueAt" | "priority" | "status">>;

/** The zone the lists are cut into days by: the one this device shows times in. */
export function taskZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function listTasks(params: ListTasksParams): Promise<TaskPage> {
  const query = new URLSearchParams({ view: params.view, tz: taskZone() });
  if (params.q) query.set("q", params.q);
  if (params.priority) query.set("priority", params.priority);
  if (params.sort) query.set("sort", params.sort);
  if (params.days) query.set("days", String(params.days));
  if (params.limit) query.set("limit", String(params.limit));
  if (params.cursor) query.set("cursor", params.cursor);
  return apiRequest<TaskPage>(`/tasks?${query}`);
}

export function getTaskSummary(): Promise<TaskSummary> {
  return apiRequest<TaskSummary>(`/tasks/summary?tz=${encodeURIComponent(taskZone())}`);
}

export function getTask(id: string): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(`/tasks/${id}`);
}

export function createTask(input: TaskInput): Promise<TaskDetail> {
  return apiRequest<TaskDetail>("/tasks", { method: "POST", body: input });
}

export function createTaskFromMessage(messageId: string, input: Omit<TaskInput, "messageId" | "threadId" | "title"> & { title?: string }): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(`/tasks/from-message/${messageId}`, { method: "POST", body: input });
}

export function updateTask(id: string, input: TaskUpdate): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(`/tasks/${id}`, { method: "PATCH", body: input });
}

export function deleteTask(id: string): Promise<void> {
  return apiRequest<void>(`/tasks/${id}`, { method: "DELETE" });
}

export function completeTask(id: string): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(`/tasks/${id}/complete`, { method: "POST" });
}

export function reopenTask(id: string, reason: string): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(`/tasks/${id}/reopen`, { method: "POST", body: { reason } });
}

export function rescheduleTask(id: string, dueAt: string): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(`/tasks/${id}/reschedule`, { method: "POST", body: { dueAt } });
}

export function addChecklistItem(id: string, text: string): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(`/tasks/${id}/checklist`, { method: "POST", body: { text } });
}

export function updateChecklistItem(id: string, itemId: string, input: { text?: string; done?: boolean }): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(`/tasks/${id}/checklist/${itemId}`, { method: "PATCH", body: input });
}

export function removeChecklistItem(id: string, itemId: string): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(`/tasks/${id}/checklist/${itemId}`, { method: "DELETE" });
}

export function reorderChecklist(id: string, itemIds: string[]): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(`/tasks/${id}/checklist/order`, { method: "PUT", body: { itemIds } });
}
