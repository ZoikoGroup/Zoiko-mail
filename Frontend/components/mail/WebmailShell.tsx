"use client";

import { type ReactNode } from "react";
import { useMemberShell } from "@/lib/useMemberShell";
import { useMyMailbox, useUnreadCounts } from "@/lib/mail-hooks";
import type { MailListFolder } from "@/lib/mail-api";
import { TopBar } from "@/components/mail/TopBar";
import { FolderRail } from "@/components/mail/FolderRail";
import { ToastContainer } from "@/components/ui/Toast";
import { NetworkBanner } from "@/components/ui/NetworkBanner";
import { AccessDenied } from "@/components/ui/AccessDenied";

/**
 * Full-screen shell for /mail — replaces AppShell there. AppShell's left
 * nav + page padding is built for the admin-style pages (account, contacts,
 * settings); webmail needs the whole viewport for its own top bar + rail +
 * list + reading pane, so this is a sibling shell, not a variant of AppShell.
 *
 * Guards and SSE/toast wiring come from useMemberShell — the same hook
 * AppShell uses — so the two shells can never disagree about who's allowed
 * to be here.
 *
 * Renders the rail, top bar, storage meter and toasts around whatever
 * `children` is (today, MailClient with hideRail + hideSearchBox set).
 * searchQuery/onSearchQueryChange are lifted to the page so the same text
 * reaches both TopBar and MailClient's operator parser (lib/mail-search.ts).
 * The mobile layout (bottom nav, folder drawer, compose FAB) isn't built
 * yet — that's Step 5; see MailClient's own comments for the mobile gap
 * this leaves in the meantime.
 */
export function WebmailShell({
  folder,
  onFolderChange,
  searchQuery,
  onSearchQueryChange,
  onCompose,
  children,
}: {
  folder: MailListFolder;
  onFolderChange: (folder: MailListFolder) => void;
  /** Lifted up to the page so the same text reaches both this bar and
   * MailClient's operator parser — see app/mail/page.tsx. */
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  /** Opens MailClient's compose modal — the page wires this to a ref on
   * MailClient (see app/mail/page.tsx) since the modal's open-state still
   * lives inside MailClient, not up here. */
  onCompose: () => void;
  children: ReactNode;
}) {
  const { me, status, logout, toasts, dismissToast } = useMemberShell();
  const { data: mailbox, isLoading: mailboxLoading } = useMyMailbox();
  const { data: unreadCounts } = useUnreadCounts();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--ground)]">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      </div>
    );
  }
  if (status === "denied-silent") {
    return null;
  }
  if (status === "denied-role") {
    return <AccessDenied role={me!.membership.role} dashboard="member" />;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--ground)] text-[var(--ink)]">
      <NetworkBanner />
      <TopBar
        query={searchQuery}
        onQueryChange={onSearchQueryChange}
        accountEmail={mailbox?.address ?? me?.email}
        onSignOut={() => logout.mutate()}
        signingOut={logout.isPending}
      />

      <div className="flex min-h-0 flex-1">
        {/* Desktop only — mobile's own folder access (drawer + bottom nav)
            is a Step 5 item. Until then, mobile keeps whatever MailClient
            renders in its own mobile folder-pill strip, if hideRail wasn't
            set for this child; see MailClient's own comment on that gap. */}
        <div className="hidden lg:block">
          <FolderRail
            folder={folder}
            onFolderChange={onFolderChange}
            unreadCounts={unreadCounts}
            onCompose={onCompose}
            storageUsed={mailbox?.storageUsed ?? 0}
            storageLimit={mailbox?.storageLimit ?? 0}
            storageLoading={mailboxLoading}
          />
        </div>

        <div className="min-w-0 flex-1">{children}</div>
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}