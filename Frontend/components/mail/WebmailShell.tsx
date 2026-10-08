"use client";

import { useState, type ReactNode } from "react";
import { useMemberShell } from "@/lib/useMemberShell";
import { useMyMailbox, useUnreadCounts } from "@/lib/mail-hooks";
import type { MailListFolder } from "@/lib/mail-api";
import { TopBar } from "@/components/mail/TopBar";
import { FolderRail, folderLabel } from "@/components/mail/FolderRail";
import { MobileHeader } from "@/components/mail/MobileHeader";
import { ComposeFab } from "@/components/mail/ComposeFab";
import { BottomNav } from "@/components/mail/BottomNav";
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
 * Desktop (lg+): TopBar + FolderRail beside `children`.
 * Mobile (< lg): MobileHeader (hamburger + folder title + avatar + search)
 * replaces TopBar; tapping the hamburger opens FolderRail as a slide-out
 * drawer instead of a fixed sidebar; a ComposeFab and BottomNav float over
 * `children`. MailClient's own "List tabs" row (All/Unread/Starred + label
 * chips on mobile) still renders inside `children` either way — it needed
 * no new component here, see its own comment in MailClient.tsx.
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
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  const railProps = {
    folder,
    unreadCounts,
    storageUsed: mailbox?.storageUsed ?? 0,
    storageLimit: mailbox?.storageLimit ?? 0,
    storageLoading: mailboxLoading,
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--ground)] text-[var(--ink)]">
      <NetworkBanner />

      <div className="hidden lg:block">
        <TopBar
          query={searchQuery}
          onQueryChange={onSearchQueryChange}
          accountEmail={mailbox?.address ?? me?.email}
          onSignOut={() => logout.mutate()}
          signingOut={logout.isPending}
        />
      </div>
      <MobileHeader
        folderLabel={folderLabel(folder)}
        onOpenDrawer={() => setDrawerOpen(true)}
        accountEmail={mailbox?.address ?? me?.email}
        query={searchQuery}
        onQueryChange={onSearchQueryChange}
      />

      <div className="flex min-h-0 flex-1">
        <div className="hidden lg:block">
          <FolderRail {...railProps} onFolderChange={onFolderChange} onCompose={onCompose} />
        </div>

        {/* Folder drawer (mobile) — same FolderRail, as a slide-out panel.
            Picking a folder closes the drawer; Compose does too, since the
            modal it opens covers the whole screen anyway. */}
        {drawerOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-64 max-w-[80vw] shadow-[var(--sh3)]">
              <FolderRail
                {...railProps}
                onFolderChange={(f) => {
                  onFolderChange(f);
                  setDrawerOpen(false);
                }}
                onCompose={() => {
                  setDrawerOpen(false);
                  onCompose();
                }}
              />
            </div>
          </div>
        )}

        {/* pb-16 clears BottomNav + safe-area on mobile; lg:pb-0 drops it
            on desktop, which has neither. */}
        <div className="min-w-0 flex-1 overflow-hidden pb-16 lg:pb-0">{children}</div>
      </div>

      <ComposeFab onClick={onCompose} />
      <BottomNav folder={folder} onFolderChange={onFolderChange} />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}