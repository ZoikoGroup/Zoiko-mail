"use client";

import { useRef, useState } from "react";
import { WebmailShell } from "@/components/mail/WebmailShell";
import { MailClient, type MailClientHandle } from "@/components/mail/MailClient";
import type { MailListFolder } from "@/lib/mail-api";

// WebmailShell replaces AppShell here — it handles the same auth guard (via
// the shared useMemberShell hook) plus its own full-screen layout (top bar +
// folder rail) instead of AppShell's sidebar console chrome. The client
// itself is unchanged and still lives in components/mail, so the admin
// workspace (/admin/inbox, /owner/inbox) keeps rendering the same
// implementation inside AppShell/AdminShell/OwnerShell with no folder prop
// and no hideRail — this is the only route passing those.
export default function MailPage() {
  const [folder, setFolder] = useState<MailListFolder>("INBOX");
  // Lifted so the same text reaches both TopBar (what the person sees and
  // types into) and MailClient's operator parser (lib/mail-search.ts) —
  // one search box, not two.
  const [searchQuery, setSearchQuery] = useState("");
  const mailClientRef = useRef<MailClientHandle>(null);

  return (
    <WebmailShell
      folder={folder}
      onFolderChange={setFolder}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      onCompose={() => mailClientRef.current?.openCompose("new", null)}
    >
      <MailClient
        ref={mailClientRef}
        folder={folder}
        onFolderChange={setFolder}
        hideRail
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        hideSearchBox
      />
    </WebmailShell>
  );
}