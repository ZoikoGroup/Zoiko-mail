"use client";

import { Suspense } from "react";
import { WebmailLoading } from "@/components/mail/WebmailLoading";
import { ContactsPage } from "@/components/contacts/ContactsPage";

/** /mail/contacts — Contacts & People Directory. ?view= picks the list; ?group= a contact group. */
export default function MemberContactsPage() {
  return (
    <Suspense fallback={<WebmailLoading />}>
      <ContactsPage />
    </Suspense>
  );
}
