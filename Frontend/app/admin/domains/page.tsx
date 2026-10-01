"use client";

import { useState } from "react";
import { useCan } from "@/lib/admin-capabilities";
import { PageHeader } from "@/components/admin/ui";
import { DomainsWorkspace } from "@/components/domains/DomainsWorkspace";

export default function AdminDomainsPage() {
  const can = useCan();
  const canManage = can("workspace.domains.manage");
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageHeader
        title="Domains"
        subtitle="DNS records, verification and deliverability for your custom domains"
        action={
          canManage ? (
            <button type="button" className="zoiko-btn pri" onClick={() => setAdding((open) => !open)}>
              {adding ? "Cancel" : "Add domain"}
            </button>
          ) : undefined
        }
      />
      <DomainsWorkspace canManage={canManage} addOpen={adding} onAddOpenChange={setAdding} />
    </>
  );
}
