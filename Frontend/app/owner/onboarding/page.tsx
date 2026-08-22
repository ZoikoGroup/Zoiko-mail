"use client";

import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { OnboardingWizard } from "@/components/owner/onboarding/OnboardingWizard";

export default function OnboardingPage() {
  return (
    <ProtectedRoute>
      <OnboardingWizard />
    </ProtectedRoute>
  );
}
