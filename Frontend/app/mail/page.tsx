"use client";

import { AppShell } from "@/components/shell/AppShell";
import { MailClient } from "@/components/mail/MailClient";

// The shell handles the auth guard, so the page composes shell + content. The
// client lives in components/mail so the admin workspace can render the same
// implementation inside its own shell.
export default function MailPage() {
  return (
    <AppShell>
      <MailClient />
    </AppShell>
  );
}
