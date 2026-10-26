"use client";

import { useEffect, useRef, useState } from "react";
import { WebmailShell } from "@/components/mail/WebmailShell";
import { MailClient, type MailClientHandle, type MailLink } from "@/components/mail/MailClient";
import type { MailListFolder, SharedInbox } from "@/lib/mail-api";

/** Folders a link may open (Contacts → Recent communications). */
const LINKABLE_FOLDERS: MailListFolder[] = ["INBOX", "SENT", "ARCHIVE", "TRASH", "STARRED", "SNOOZED"];

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
  const [link, setLink] = useState<MailLink | null>(null);

  // Links from elsewhere in the workspace:
  //   ?compose=<address>           a new message to that address
  //   ?open=<messageId>&folder=X   that message, in that folder
  // Read once, then removed from the address bar so a reload does not repeat them.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const compose = params.get("compose");
    const open = params.get("open");
    const linkedFolder = params.get("folder") as MailListFolder | null;
    if (!compose && !open) return;
    if (linkedFolder && LINKABLE_FOLDERS.includes(linkedFolder)) setFolder(linkedFolder);
    setLink({
      compose: compose?.trim() || undefined,
      open: open && /^[0-9a-f-]{36}$/i.test(open) ? open : undefined,
    });
    window.history.replaceState(null, "", "/mail");
  }, []);

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
        link={link}
      />
    </WebmailShell>
  );
}
