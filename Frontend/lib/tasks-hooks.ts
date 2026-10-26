"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addChecklistItem,
  completeTask,
  createTask,
  createTaskFromMessage,
  deleteTask,
  getTask,
  followTask,
  getTaskActivity,
  getTaskSummary,
  searchTasks,
  listAssignees,
  listTaskTeams,
  listTasks,
  removeChecklistItem,
  reopenTask,
  reorderChecklist,
  rescheduleTask,
  updateChecklistItem,
  updateTask,
  type ListTasksParams,
  type TaskDetail,
  type TaskInput,
  type TaskUpdate,
} from "./tasks-api";

/** Every task query lives under this key, so one invalidation refreshes them all. */
export const TASKS_ROOT = ["tasks"] as const;
const detailKey = (id: string) => ["tasks", "detail", id] as const;

export function useTasks(params: ListTasksParams, enabled = true) {
  return useQuery({
    queryKey: ["tasks", "list", params],
    queryFn: () => listTasks(params),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
    enabled,
  });
}

export function useTaskSummary() {
  return useQuery({ queryKey: ["tasks", "summary"], queryFn: getTaskSummary, staleTime: 30_000 });
}

export function useTaskTeams() {
  return useQuery({ queryKey: ["tasks", "teams"], queryFn: listTaskTeams, staleTime: 30_000 });
}

export function useAssignees(teamId: string | null | undefined, q: string, enabled = true) {
  return useQuery({
    queryKey: ["tasks", "assignees", teamId ?? null, q],
    queryFn: () => listAssignees({ teamId, q }),
    staleTime: 60_000,
    placeholderData: (previous) => previous,
    enabled,
  });
}

export function useTaskActivity(id: string) {
  return useQuery({ queryKey: ["tasks", "activity", id], queryFn: () => getTaskActivity(id), staleTime: 15_000 });
}

/** Tasks matching what is typed in the top bar. */
export function useTaskSearch(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: ["tasks", "search", term],
    queryFn: () => searchTasks(term),
    enabled: term.length >= 2,
    staleTime: 15_000,
    placeholderData: (previous) => previous,
  });
}

export function useFollowTask() {
  return useTaskWrite(({ id, follow }: { id: string; follow: boolean }) => followTask(id, follow));
}

export function useTask(id: string | null) {
  return useQuery({ queryKey: detailKey(id ?? ""), queryFn: () => getTask(id!), enabled: Boolean(id) });
}

/**
 * A change to one task moves lists, counts and the inbox's commitments
 * together, so every write refreshes all of them rather than guessing which
 * caches it touched. The detail the server returned is put in place first,
 * so the open panel does not flicker back to the old values.
 */
function useTaskWrite<Vars, Result extends TaskDetail | void>(mutationFn: (vars: Vars) => Promise<Result>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (task: Result) => {
      if (task) queryClient.setQueryData(detailKey(task.id), task);
      void queryClient.invalidateQueries({ queryKey: TASKS_ROOT });
      void queryClient.invalidateQueries({ queryKey: ["actions"] });
    },
  });
}

export function useCreateTask() {
  return useTaskWrite((input: TaskInput) => createTask(input));
}

export function useCreateTaskFromMessage() {
  return useTaskWrite(({ messageId, input }: { messageId: string; input: Parameters<typeof createTaskFromMessage>[1] }) =>
    createTaskFromMessage(messageId, input)
  );
}

export function useUpdateTask() {
  return useTaskWrite(({ id, input }: { id: string; input: TaskUpdate }) => updateTask(id, input));
}

export function useDeleteTask() {
  return useTaskWrite((id: string) => deleteTask(id));
}

export function useCompleteTask() {
  return useTaskWrite((id: string) => completeTask(id));
}

export function useReopenTask() {
  return useTaskWrite(({ id, reason }: { id: string; reason: string }) => reopenTask(id, reason));
}

export function useRescheduleTask() {
  return useTaskWrite(({ id, dueAt }: { id: string; dueAt: string }) => rescheduleTask(id, dueAt));
}

export function useAddChecklistItem() {
  return useTaskWrite(({ id, text }: { id: string; text: string }) => addChecklistItem(id, text));
}

export function useRemoveChecklistItem() {
  return useTaskWrite(({ id, itemId }: { id: string; itemId: string }) => removeChecklistItem(id, itemId));
}

export function useReorderChecklist() {
  return useTaskWrite(({ id, itemIds }: { id: string; itemIds: string[] }) => reorderChecklist(id, itemIds));
}

/** Ticking an item shows at once and settles to what the server stored. */
export function useToggleChecklistItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, itemId, done }: { id: string; itemId: string; done: boolean }) => updateChecklistItem(id, itemId, { done }),
    onMutate: async ({ id, itemId, done }) => {
      await queryClient.cancelQueries({ queryKey: detailKey(id) });
      const previous = queryClient.getQueryData<TaskDetail>(detailKey(id));
      if (previous) {
        const checklist = previous.checklist.map((item) => (item.id === itemId ? { ...item, done } : item));
        queryClient.setQueryData<TaskDetail>(detailKey(id), {
          ...previous,
          checklist,
          checklistProgress: { done: checklist.filter((item) => item.done).length, total: checklist.length },
        });
      }
      return { previous };
    },
    onError: (_error, { id }, context) => {
      if (context?.previous) queryClient.setQueryData(detailKey(id), context.previous);
    },
    onSuccess: (task) => queryClient.setQueryData(detailKey(task.id), task),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["tasks", "list"] }),
  });
}
