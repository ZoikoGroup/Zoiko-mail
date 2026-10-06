import {
  LayoutDashboard, Link2,
  Mail, KeyRound, Settings,
  type LucideIcon,
} from "lucide-react";

export type NavStatus = "live" | "soon";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  status: NavStatus;
  desc: string;
  section: string;
}

// The single top-level item (its own thing, shown above the grouped features).
// Shared across all role dashboards that use AppShell.
export const DASHBOARD_ITEM: NavItem = {
  label: "Dashboard",
  href: "/",
  icon: LayoutDashboard,
  status: "live",
  desc: "Your workspace at a glance.",
  section: "",
};

// ---------------------------------------------------------------------------
// MEMBER_NAV — items visible to OWNER / ADMIN / MEMBER on the member
// dashboard. Admin-only items (Members & roles, Policies, Audit log,
// Domains & DNS) live in ADMIN_NAV below and are NOT included here.
// Backend routes for those items are already role-guarded server-side; this
// split just makes the sidebar honest about who each item is for.
//
// Track A (Action Inbox, Connected accounts, Threads, Notifications,
// Digest, AI drafting) used to live here. Webmail is the member home now —
// WORKSPACE_HREF.MEMBER in lib/workspace.ts points at /mail, which has its
// own full-screen shell (WebmailShell) and isn't reached through this
// sidebar at all. The Track A pages still exist and redirect to /mail if
// visited directly; see each page's own comment for why.
// ---------------------------------------------------------------------------
export const MEMBER_NAV: NavItem[] = [
  {
    section: "Hosted mail", label: "Webmail", href: "/mail", icon: Mail, status: "live",
    desc: "Send and receive from your Zoiko mailbox."
  },
  {
    section: "Account", label: "Profile", href: "/account", icon: KeyRound, status: "live",
    desc: "Your account details and sign-in security."
  },
  {
    section: "Contacts", label: "Contacts", href: "/contacts", icon: Link2, status: "live",
    desc: "Manage your personal and team contacts."
  },
  {
    section: "Account", label: "Settings", href: "/settings", icon: Settings, status: "live",
    desc: "Appearance, notifications, and preferences."
  },
];

// Ordered, de-duplicated section names for grouped rendering.
// Takes a nav array so callers pass whichever role's nav they're rendering.
export function sectionsFor(nav: NavItem[]): string[] {
  return nav.reduce<string[]>((acc, i) => {
    if (!acc.includes(i.section)) acc.push(i.section);
    return acc;
  }, []);
}