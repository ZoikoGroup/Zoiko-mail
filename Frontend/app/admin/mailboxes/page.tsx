"use client";

import { MailboxesManager } from "@/components/mailboxes/MailboxesManager";

export default function AdminMailboxesPage() {
  return <MailboxesManager domainsHref="/admin/domains" />;
}
