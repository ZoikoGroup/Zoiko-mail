"use client";

import { useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { DomainsWorkspace } from "@/components/domains/DomainsWorkspace";

export default function DomainsPage() {
  const [adding, setAdding] = useState(false);
  return (
    <ProtectedRoute>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Domains"
          description="DNS records, verification and deliverability for your organization's domains."
          actions={
            <button type="button" className="zoiko-btn pri" onClick={() => setAdding((open) => !open)}>
              {adding ? "Cancel" : "Add domain"}
            </button>
          }
        />
        <div>
          {/* Owners hold every domain capability; the server still decides. */}
          <DomainsWorkspace canManage addOpen={adding} onAddOpenChange={setAdding} />
        </div>
      </div>
    </ProtectedRoute>
  );
}
