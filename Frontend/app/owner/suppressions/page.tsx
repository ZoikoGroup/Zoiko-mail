import type { Metadata } from "next";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { SuppressionsTable } from "@/components/owner/deliverability/SuppressionsTable";

export const metadata: Metadata = { title: "Suppressions" };

export default function SuppressionsPage() {
  return (
    <ProtectedRoute allowedRoles={["OWNER", "ADMIN"]}>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Suppressions"
          description="Recipients who must never receive mail from your workspace."
        />
        <div className="zoiko-card p-6">
          <SuppressionsTable />
        </div>
      </div>
    </ProtectedRoute>
  );
}
