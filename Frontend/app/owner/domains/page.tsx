"use client";

import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { DomainsTable } from "@/components/owner/domains/DomainsTable";

export default function DomainsPage() {
  return (
    <ProtectedRoute>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Domains"
          description="Manage DNS settings and domain verification for your organization."
        />
        <DomainsTable />
      </div>
    </ProtectedRoute>
  );
}
