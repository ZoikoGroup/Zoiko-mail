"use client";

import { Check } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateCalendar, type AccessibleCalendar, type CalendarAccess, type EffectiveAccess } from "@/lib/calendar-api";
import { swatchStyle } from "./palette";

export const ACCESS_OPTIONS: { value: CalendarAccess; label: string; hint: string }[] = [
  { value: "FREE_BUSY", label: "Free/Busy", hint: "Sees only that the time is taken" },
  { value: "VIEW", label: "View details", hint: "Sees events and their details" },
  { value: "EDIT", label: "Edit", hint: "Adds and changes events" },
  { value: "MANAGE", label: "Manage", hint: "Also decides who has access" },
];

export const ACCESS_LABEL: Record<EffectiveAccess, string> = {
  FREE_BUSY: "Free/Busy",
  VIEW: "View details",
  EDIT: "Edit",
  MANAGE: "Manage",
  OWNER: "Owner",
};

/** The short tag beside a shared calendar in the sidebar. */
export const ACCESS_TAG: Record<EffectiveAccess, string> = {
  FREE_BUSY: "Busy",
  VIEW: "Details",
  EDIT: "Edit",
  MANAGE: "Manage",
  OWNER: "Owner",
};

export function AccessPill({ access }: { access: EffectiveAccess }) {
  const tone =
    access === "FREE_BUSY" ? "#7C8DA6" : access === "VIEW" ? "#3B7BF6" : access === "EDIT" ? "#22B07D" : "#A78BFA";
  return (
    <span
      className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide"
      style={{ color: tone, borderColor: `color-mix(in srgb, ${tone} 45%, transparent)`, backgroundColor: `color-mix(in srgb, ${tone} 14%, transparent)` }}
    >
      {ACCESS_TAG[access]}
    </span>
  );
}

/**
 * Checkboxes for calendars shown on a page (team or shared). Each person's
 * choice is their own: it never changes what anyone else sees.
 */
export function CalendarChecklist({
  calendars,
  showAccess = false,
  testId,
}: {
  calendars: AccessibleCalendar[];
  showAccess?: boolean;
  testId?: string;
}) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: ({ id, isVisible }: { id: string; isVisible: boolean }) => updateCalendar(id, { isVisible }),
    onMutate: async ({ id, isVisible }) => {
      await queryClient.cancelQueries({ queryKey: ["calendar", "accessible"] });
      const previous = queryClient.getQueryData<AccessibleCalendar[]>(["calendar", "accessible"]);
      queryClient.setQueryData<AccessibleCalendar[]>(["calendar", "accessible"], (list) =>
        list?.map((c) => (c.id === id ? { ...c, isVisible } : c))
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["calendar", "accessible"], ctx.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["calendar", "accessible"] }),
  });

  return (
    <ul className="space-y-0.5" data-testid={testId}>
      {calendars.map((calendar) => (
        <li key={calendar.id} className="rounded-lg hover:bg-[var(--s2)]">
          <label className="flex min-w-0 cursor-pointer items-center gap-3 px-3 py-1.5 text-[13px] text-[var(--ink2)]">
            <input
              type="checkbox"
              className="peer sr-only"
              checked={calendar.isVisible}
              onChange={(e) => toggle.mutate({ id: calendar.id, isVisible: e.target.checked })}
              aria-label={`Show ${calendar.name}`}
            />
            <span
              aria-hidden
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-transparent peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent)]"
              style={calendar.isVisible ? swatchStyle(calendar.color) : { borderColor: "var(--border)" }}
            >
              {calendar.isVisible && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
            </span>
            <span className="min-w-0 flex-1 truncate" title={calendar.owner ? `${calendar.name} · ${calendar.owner.name}` : calendar.name}>
              {calendar.name}
            </span>
            {showAccess && <AccessPill access={calendar.access} />}
          </label>
        </li>
      ))}
    </ul>
  );
}
