"use client";

import { AppShell } from "@/components/shell/AppShell";
import { MailClient } from "@/components/mail/MailClient";

// The shell handles the auth guard, so the page just composes shell + content.
// The client itself lives in components/mail so the admin workspace can render
// the same implementation inside its own shell.
export default function MailPage() {
  return (
    <AppShell>
      <MailClient />
    </AppShell>
  );
}
