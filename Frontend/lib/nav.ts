import {
  LayoutDashboard, Inbox, Link2, MessagesSquare, Bell, Sparkles,
  Mail, Globe, Users, ShieldCheck, FileText, KeyRound, Settings,
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
// ---------------------------------------------------------------------------
export const MEMBER_NAV: NavItem[] = [
  // Track A — the first-ship intelligence layer
  { section: "Track A · Intelligence", label: "Action Inbox", href: "/inbox", icon: Inbox, status: "live",
    desc: "Review and triage commitments, replies owed, and deadlines." },
  { section: "Track A · Intelligence", label: "Connected accounts", href: "/connected-accounts", icon: Link2, status: "live",
    desc: "Connect Gmail or Microsoft 365 (read-only) to detect actions." },
  { section: "Track A · Intelligence", label: "Threads & messages", href: "/threads", icon: MessagesSquare, status: "soon",
    desc: "Browse conversations behind each detected action." },
  { section: "Track A · Intelligence", label: "Daily digest", href: "/digest", icon: Bell, status: "soon",
    desc: "A once-a-day summary of what needs your attention." },
  { section: "Track A · Intelligence", label: "AI drafting & summaries", href: "/ai", icon: Sparkles, status: "live",
    desc: "Draft replies and summarize threads — you always send." },

  // Track B — hosted mail
  { section: "Track B · Hosted mail", label: "Webmail", href: "/mail", icon: Mail, status: "live",
    desc: "Send and receive from your Zoiko mailbox." },

  // Account
  { section: "Account", label: "Profile", href: "/account", icon: KeyRound, status: "live",
    desc: "Your account details and sign-in security." },
  { section: "Account", label: "Settings", href: "/settings", icon: Settings, status: "live",
    desc: "Appearance, notifications, and preferences." },
];

// ---------------------------------------------------------------------------
// ADMIN_NAV — items visible to OWNER / ADMIN on the admin dashboard.
// Extends MEMBER_NAV with governance and domain-management items. The
// admin dashboard route (/admin) does not exist yet in the codebase; this
// array is defined here so the teammate building it has one place to plug
// in extra items without touching the member config.
// ---------------------------------------------------------------------------
export const ADMIN_NAV: NavItem[] = [
  ...MEMBER_NAV,

  // Domain management (extends Track B)
  { section: "Track B · Hosted mail", label: "Domains & DNS", href: "/domains", icon: Globe, status: "soon",
    desc: "Add a domain and verify MX / SPF / DKIM / DMARC." },

  // Team & governance — admin-only
  { section: "Team & governance", label: "Members & roles", href: "/members", icon: Users, status: "soon",
    desc: "Invite teammates and manage roles." },
  { section: "Team & governance", label: "Policies", href: "/policies", icon: ShieldCheck, status: "soon",
    desc: "Control AI and data-handling policy for the workspace." },
  { section: "Team & governance", label: "Audit log", href: "/audit", icon: FileText, status: "soon",
    desc: "Every privileged and AI action, append-only." },
];

// Ordered, de-duplicated section names for grouped rendering.
// Takes a nav array so callers pass whichever role's nav they're rendering.
export function sectionsFor(nav: NavItem[]): string[] {
  return nav.reduce<string[]>((acc, i) => {
    if (!acc.includes(i.section)) acc.push(i.section);
    return acc;
  }, []);
}

// Back-compat aliases so nothing that imports `NAV` or `SECTIONS` breaks
// immediately — AppShell and app/page.tsx will be updated in the next steps
// to use MEMBER_NAV / sectionsFor(MEMBER_NAV) explicitly, and then these
// two lines can be removed.
// export const NAV = MEMBER_NAV;
// export const SECTIONS = sectionsFor(MEMBER_NAV);