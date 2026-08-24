import type { Metadata } from "next";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { DeliveryEventsTable } from "@/components/owner/deliverability/DeliveryEventsTable";

export const metadata: Metadata = { title: "Delivery Events" };

export default function DeliveryEventsPage() {
  return (
    <ProtectedRoute allowedRoles={["OWNER", "ADMIN"]}>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Delivery Events"
          description="Per-recipient delivery outcomes across all workspace mail."
        />
        <div className="zoiko-card p-6">
          <DeliveryEventsTable />
        </div>
      </div>
    </ProtectedRoute>
  );
}
