/**
 * Admin page header.
 *
 * This is a thin adapter over components/ui/PageHeader rather than a second
 * implementation. The two were genuinely the same component under two prop
 * vocabularies — `subtitle`/`action` here, `description`/`actions` there — and
 * keeping both would have meant every future change landing twice.
 *
 * The adapter survives for two reasons: it keeps the admin screens' prop names
 * stable (fourteen pages, no churn), and it owns the admin-specific bottom
 * margin, which the shared component deliberately does not impose.
 */

import type { ReactNode } from "react";
import { PageHeader as SharedPageHeader } from "@/components/ui/PageHeader";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5">
      <SharedPageHeader title={title} description={subtitle} actions={action} />
    </div>
  );
}
