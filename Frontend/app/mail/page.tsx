"use client";

import { useRef, useState } from "react";
import { WebmailShell } from "@/components/mail/WebmailShell";
import { MailClient, type MailClientHandle } from "@/components/mail/MailClient";
import type { MailListFolder, SharedInbox } from "@/lib/mail-api";

// WebmailShell replaces AppShell here: the same guards (through the shared
// useMemberShell hook) with the full-screen mail layout. MailClient itself is
// the one the Admin and Owner inbox pages render inside their own shells, with
// no folder prop and their own rail; this is the only route lifting folder,
// search, label and shared-inbox state up to a shell.
export default function MailPage() {
  const [folder, setFolder] = useState<MailListFolder>("INBOX");
  // Lifted so the same text reaches both TopBar (what the person sees and
  // types into) and MailClient's operator parser (lib/mail-search.ts).
  const [searchQuery, setSearchQuery] = useState("");
  const [labelId, setLabelId] = useState("");
  const [sharedInbox, setSharedInbox] = useState<SharedInbox | null>(null);
  const mailClientRef = useRef<MailClientHandle>(null);

  return (
    <WebmailShell
      section="mail"
      folder={folder}
      onFolderChange={setFolder}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      onCompose={() => mailClientRef.current?.openCompose("new", null)}
      labelId={labelId}
      onLabelChange={setLabelId}
      sharedInbox={sharedInbox}
      onOpenShared={setSharedInbox}
    >
      <MailClient
        ref={mailClientRef}
        folder={folder}
        onFolderChange={setFolder}
        hideRail
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        hideSearchBox
        labelId={labelId}
        onLabelChange={setLabelId}
        sharedInbox={sharedInbox}
      />
    </WebmailShell>
  );
}
