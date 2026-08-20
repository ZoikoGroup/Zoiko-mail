"use client";

import { Inbox } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <span className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-[var(--s3)] text-[var(--ink3)]">
        {icon ?? <Inbox className="h-7 w-7" />}
      </span>
      <h3 className="mt-4 text-sm font-semibold text-[var(--ink)]">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-[var(--ink3)]">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
