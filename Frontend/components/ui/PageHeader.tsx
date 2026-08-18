"use client";

import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="font-editorial text-xl font-semibold tracking-tight text-[var(--ink)] sm:text-2xl">
          {title}
        </h1>
        {description && (
          <p className="mt-0.5 text-sm text-[var(--ink3)]">{description}</p>
        )}
      </div>
      {actions && <div className="mt-2 flex items-center gap-2 sm:mt-0">{actions}</div>}
    </div>
  );
}
