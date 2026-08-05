'use client';

import { Ban, Check, ChevronRight } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import type { Workspace } from '@/types/workspace';
import { cn } from '@/utils/cn';

/**
 * A selectable workspace row.
 *
 * Unavailable rows stay visible rather than vanishing: the reason someone
 * cannot enter a workspace is information they need, and a silently missing
 * option reads as a bug. Rows the user has been removed from are filtered
 * out upstream — see types/workspace.isListable.
 */
export function WorkspaceOption({
  workspace,
  caption,
  selected = false,
  unavailable = false,
  onSelect,
}: {
  workspace: Workspace;
  caption: string;
  selected?: boolean;
  unavailable?: boolean;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={unavailable ? undefined : onSelect}
      disabled={unavailable}
      aria-pressed={unavailable ? undefined : selected}
      className={cn(
        'flex w-full items-center gap-3 rounded-tile border bg-surface p-[13px] text-left',
        'transition-all duration-150 ease-premium',
        unavailable
          ? 'cursor-not-allowed border-border opacity-50'
          : selected
            ? 'border-accent shadow-[0_0_0_2px_var(--accent-soft)]'
            : 'border-border hover:border-bstrong hover:bg-s2',
      )}
    >
      <Avatar tone={unavailable ? 'crit' : workspace.tone}>{workspace.initial}</Avatar>

      <span className="min-w-0 flex-1">
        <span className="block text-base2 font-semibold">{workspace.name}</span>
        <span className="block font-mono text-[9.5px] uppercase tracking-[0.07em] text-ink-3">{caption}</span>
      </span>

      {unavailable ? (
        <Ban aria-hidden className="h-3.5 w-3.5 shrink-0 text-crit" strokeWidth={1.9} />
      ) : selected ? (
        <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.9} />
      ) : (
        <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-3" strokeWidth={1.9} />
      )}
    </button>
  );
}
