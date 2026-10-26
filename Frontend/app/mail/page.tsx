"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { WebmailShell } from "@/components/mail/WebmailShell";
import { MailClient, type MailClientHandle } from "@/components/mail/MailClient";
import { useSharedInboxes } from "@/lib/mail-hooks";
import type { MailListFolder, SharedInbox } from "@/lib/mail-api";

const FOLDERS: MailListFolder[] = ["INBOX", "SENT", "DRAFTS", "ARCHIVE", "TRASH", "QUARANTINE", "SPAM", "SNOOZED", "SCHEDULED", "STARRED"];

/**
 * /mail?message=<id>&folder=<FOLDER>[&mailbox=<shared inbox id>] opens that
 * message — the link a task's "Open source email" follows.
 */
export default function MailPage() {
  return (
    <Suspense>
      <MailPageInner />
    </Suspense>
  );
}

// WebmailShell replaces AppShell here: the same guards (through the shared
// useMemberShell hook) with the full-screen mail layout. MailClient itself is
// the one the Admin and Owner inbox pages render inside their own shells, with
// no folder prop and their own rail; this is the only route lifting folder,
// search, label and shared-inbox state up to a shell.
function MailPageInner() {
  const params = useSearchParams();
  const linkedFolder = params.get("folder") as MailListFolder | null;
  const [folder, setFolder] = useState<MailListFolder>(linkedFolder && FOLDERS.includes(linkedFolder) ? linkedFolder : "INBOX");
  // Lifted so the same text reaches both TopBar (what the person sees and
  // types into) and MailClient's operator parser (lib/mail-search.ts).
  const [searchQuery, setSearchQuery] = useState("");
  const [labelId, setLabelId] = useState("");
  const [sharedInbox, setSharedInbox] = useState<SharedInbox | null>(null);
  const mailClientRef = useRef<MailClientHandle>(null);

  // ?mailbox=<id>: the linked message is in a shared inbox, so open that
  // inbox first, then the message in it. Once only — after that the person
  // moves between inboxes freely.
  const linkedMailbox = params.get("mailbox");
  const { data: sharedInboxes } = useSharedInboxes();
  const linkApplied = useRef(false);
  useEffect(() => {
    if (!linkedMailbox || linkApplied.current || !sharedInboxes) return;
    linkApplied.current = true;
    const inbox = sharedInboxes.find((m) => m.id === linkedMailbox);
    if (inbox) setSharedInbox(inbox);
  }, [linkedMailbox, sharedInboxes]);
  const linkResolved = !linkedMailbox || sharedInbox?.id === linkedMailbox || (sharedInboxes !== undefined && !sharedInboxes.some((m) => m.id === linkedMailbox));

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
        openMessageId={linkResolved ? params.get("message") : null}
      />
    </WebmailShell>
  );
}
