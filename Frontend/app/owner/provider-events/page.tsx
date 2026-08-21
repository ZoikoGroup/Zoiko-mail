import type { Metadata } from "next";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProviderEventsTable } from "@/components/owner/deliverability/ProviderEventsTable";

export const metadata: Metadata = { title: "Provider Events" };

export default function ProviderEventsPage() {
  return (
    <ProtectedRoute allowedRoles={["OWNER", "ADMIN"]}>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Provider Events"
          description="Sync and webhook activity from connected mail providers."
        />
        <div className="zoiko-card p-6">
          <ProviderEventsTable />
        </div>
      </div>
    </ProtectedRoute>
  );
}
