'use client';

import type { LucideIcon } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/utils/cn';

/**
 * A radio-style choice with an icon, used by the recovery options. Rendered
 * as a button rather than a native radio because each option navigates
 * rather than setting a form value.
 */
export function OptionCard({
  icon: Icon,
  title,
  detail,
  selected = false,
  onSelect,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  selected?: boolean;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-center gap-3 rounded-tile border bg-surface p-[13px] text-left transition-all duration-150 ease-premium',
        selected ? 'border-accent shadow-[0_0_0_2px_var(--accent-soft)]' : 'border-border hover:border-bstrong hover:bg-s2',
      )}
    >
      <Avatar tone={selected ? 'accent' : 'muted'}>
        <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
      </Avatar>

      <span className="min-w-0">
        <span className="block text-base2 font-semibold">{title}</span>
        <span className="block font-mono text-[9.5px] uppercase tracking-[0.07em] text-ink-3">{detail}</span>
      </span>
    </button>
  );
}
