"use client";

import { useRef, useState, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import { useMemberShell } from "@/lib/useMemberShell";
import { useMyMailbox, useUnreadCounts } from "@/lib/mail-hooks";
import type { MailListFolder, SharedInbox } from "@/lib/mail-api";
import { TopBar } from "@/components/mail/TopBar";
import { FolderRail, folderLabel } from "@/components/mail/FolderRail";
import { AppRail, sectionInfo, type WorkspaceSection } from "@/components/mail/AppRail";
import { MobileHeader } from "@/components/mail/MobileHeader";
import { ComposeFab } from "@/components/mail/ComposeFab";
import { BottomNav } from "@/components/mail/BottomNav";
import { ToastContainer } from "@/components/ui/Toast";
import { NetworkBanner } from "@/components/ui/NetworkBanner";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { PaneDivider } from "@/components/mail/PaneDivider";
import { FOLDER_PANE, PaneLayoutProvider, usePaneLayout } from "@/lib/pane-layout";

/**
 * The Member workspace's full-screen shell: top bar, the section rail
 * (Mail, Calendar, Tasks, Contacts, Work Graph, Alet), and — in Mail — the
 * folder column beside `children`. The other sections render their Coming
 * Soon page as `children`, in the same shell.
 *
 * Guards and the live-update/toast wiring come from useMemberShell, the hook
 * AppShell uses too, so the two shells never disagree about who may be here.
 *
 * Desktop (lg+): TopBar, AppRail, FolderRail, content.
 * Phone (< lg): MobileHeader with a folder drawer, the content, a compose
 * button and the section BottomNav.
 *
 * Wrapped in .zm-webmail, which re-values the design tokens for the mail
 * look (globals.css) without touching the other consoles.
 */
export function WebmailShell(props: ComponentProps<typeof WebmailShellInner>) {
  // The pane sizes are shared by the top bar's Layout menu, the folder
  // column here and the list inside MailClient, so they live above all three.
  return (
    <PaneLayoutProvider>
      <WebmailShellInner {...props} />
    </PaneLayoutProvider>
  );
}

function WebmailShellInner({
  section = "mail",
  folder = "INBOX",
  onFolderChange,
  searchQuery = "",
  onSearchQueryChange,
  onCompose,
  labelId = "",
  onLabelChange,
  sharedInbox = null,
  onOpenShared,
  children,
}: {
  section?: WorkspaceSection;
  folder?: MailListFolder;
  onFolderChange?: (folder: MailListFolder) => void;
  /** Lifted to the page so the same text reaches this bar and MailClient. */
  searchQuery?: string;
  onSearchQueryChange?: (value: string) => void;
  /** Opens MailClient's composer (wired through a ref by app/mail/page.tsx). */
  onCompose?: () => void;
  labelId?: string;
  onLabelChange?: (labelId: string) => void;
  /** The shared inbox being read, or null for one's own mailbox. */
  sharedInbox?: SharedInbox | null;
  onOpenShared?: (inbox: SharedInbox | null) => void;
  children: ReactNode;
}) {
  const { me, status, logout, toasts, dismissToast } = useMemberShell();
  const { data: mailbox, isLoading: mailboxLoading } = useMyMailbox();
  const { data: unreadCounts } = useUnreadCounts();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const inMail = section === "mail";
  const layout = usePaneLayout();
  const folderPane = useRef<HTMLDivElement>(null);

  if (status === "loading") {
    // Every member section (Mail, Calendar, Tasks, Work Graph…) opens behind
    // this, so the caption names the app; the section's own loader follows.
    return <BrandLoader className="zm-webmail" label="Loading Zoiko Mail" />;
  }
  if (status === "denied-silent") {
    return null;
  }
  if (status === "denied-role") {
    return <AccessDenied role={me!.membership.role} dashboard="member" />;
  }

  const noop = () => undefined;
  const railProps = {
    folder,
    unreadCounts,
    storageUsed: mailbox?.storageUsed ?? 0,
    storageLimit: mailbox?.storageLimit ?? 0,
    storageLoading: mailboxLoading,
    labelId,
    onLabelChange,
    sharedMailboxId: sharedInbox?.id ?? null,
    onOpenShared,
  };
  const accountEmail = mailbox?.address ?? me?.email;
  const mobileTitle = !inMail
    ? sectionInfo(section).label
    : sharedInbox
      ? sharedInbox.address
      : folderLabel(folder);

  return (
    <div className="zm-webmail flex h-screen flex-col overflow-hidden bg-[var(--ground)] text-[var(--ink)]">
      <a
        href="#workspace-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-[var(--accent)] focus:px-3 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>
      <NetworkBanner />

      <div className="hidden lg:block">
        <TopBar
          query={searchQuery}
          onQueryChange={onSearchQueryChange}
          placeholder={inMail ? undefined : "Search tasks — title or description"}
          accountEmail={accountEmail}
          displayName={me?.displayName}
          workspaceName={me?.tenant?.name}
          onSignOut={() => logout.mutate()}
          signingOut={logout.isPending}
        />
      </div>
      <MobileHeader
        title={mobileTitle}
        onOpenDrawer={inMail ? () => setDrawerOpen(true) : undefined}
        accountEmail={accountEmail}
        displayName={me?.displayName}
        query={searchQuery}
        onQueryChange={onSearchQueryChange ?? noop}
        showSearch={inMail}
      />

      <div className="flex min-h-0 flex-1">
        <div className="hidden lg:block">
          <AppRail active={section} />
        </div>
        {inMail && (
          <>
            <div
              ref={folderPane}
              data-testid="folder-pane"
              className="hidden w-[var(--zm-folder-w,240px)] shrink-0 lg:block"
              style={
                layout?.effectiveFolderWidth
                  ? ({ "--zm-folder-w": `${layout.effectiveFolderWidth}px` } as CSSProperties)
                  : undefined
              }
            >
              <FolderRail {...railProps} fill onFolderChange={onFolderChange ?? noop} onCompose={onCompose ?? noop} />
            </div>
            {layout && (
              <PaneDivider
                label="Resize folder pane"
                testId="folder-divider"
                paneRef={folderPane}
                cssVar="--zm-folder-w"
                min={FOLDER_PANE.min}
                max={() => FOLDER_PANE.max}
                onCommit={layout.setFolderWidth}
                onReset={layout.reset}
              />
            )}
          </>
        )}

        {/* Folder drawer (phone) — the same FolderRail as a slide-out panel.
            Choosing anything closes it. */}
        {inMail && drawerOpen && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-label="Folders">
            <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
            <div className="absolute inset-y-0 left-0 max-w-[85vw] shadow-[var(--sh3)]">
              <FolderRail
                {...railProps}
                onFolderChange={(f) => {
                  onFolderChange?.(f);
                  setDrawerOpen(false);
                }}
                onLabelChange={(id) => {
                  onLabelChange?.(id);
                  if (id) setDrawerOpen(false);
                }}
                onOpenShared={(inbox) => {
                  onOpenShared?.(inbox);
                  if (inbox) setDrawerOpen(false);
                }}
                onCompose={() => {
                  setDrawerOpen(false);
                  onCompose?.();
                }}
              />
            </div>
          </div>
        )}

        {/* pb-16 clears BottomNav and the safe area on phones. */}
        <main id="workspace-main" className="min-w-0 flex-1 overflow-hidden pb-16 lg:pb-0">
          {children}
        </main>
      </div>

      {inMail && onCompose && <ComposeFab onClick={onCompose} />}
      <BottomNav active={section} />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
