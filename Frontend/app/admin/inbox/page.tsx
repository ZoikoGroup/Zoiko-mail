"use client";

import { MailClient } from "@/components/mail/MailClient";

/**
 * The Admin's own mailbox, rendered inside the admin shell.
 *
 * An Admin has a mailbox like any Member, but following a rail item should never
 * eject them into the member workspace — they would lose the admin rail with no
 * way back. So this route reuses the same MailClient component the member route
 * renders; the surrounding AdminShell comes from app/admin/layout.tsx.
 *
 * Note this reads live data (useMailList / useMessage), unlike the fixture-backed
 * administration screens.
 */
export default function AdminInboxPage() {
  return <MailClient />;
}
