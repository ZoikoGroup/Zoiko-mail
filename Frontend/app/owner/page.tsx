"use client";

import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { WelcomeSection } from "@/components/owner/overview/WelcomeSection";
import { SummaryCards } from "@/components/owner/overview/SummaryCards";
import { MailActivityChart } from "@/components/owner/overview/MailActivityChart";
import { SetupChecklist } from "@/components/owner/overview/SetupChecklist";
import { QuickActions } from "@/components/owner/overview/QuickActions";

export default function OwnerOverviewPage() {
  return (
    <ProtectedRoute>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <WelcomeSection />
        <SummaryCards />
        <QuickActions />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <MailActivityChart />
          <SetupChecklist />
        </div>
      </div>
    </ProtectedRoute>
  );
}
