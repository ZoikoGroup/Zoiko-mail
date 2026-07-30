import {
  LayoutDashboard, Inbox, Link2, MessagesSquare, Bell, Sparkles,
  Mail, Globe, Users, ShieldCheck, FileText, KeyRound,
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
export const DASHBOARD_ITEM: NavItem = {
  label: "Dashboard",
  href: "/",
  icon: LayoutDashboard,
  status: "live",
  desc: "Your workspace at a glance.",
  section: "",
};

// Everything the product will offer. Built = "live" (real link); rest = "soon".
// Both the sidebar and the dashboard read from this list, so they stay in sync.
export const NAV: NavItem[] = [
  // Track A — the first-ship intelligence layer
  { section: "Track A · Intelligence", label: "Action Inbox", href: "/inbox", icon: Inbox, status: "live",
    desc: "Review and triage commitments, replies owed, and deadlines." },
  { section: "Track A · Intelligence", label: "Connected accounts", href: "/connected-accounts", icon: Link2, status: "soon",
    desc: "Connect Gmail or Microsoft 365 (read-only) to detect actions." },
  { section: "Track A · Intelligence", label: "Threads & messages", href: "/threads", icon: MessagesSquare, status: "soon",
    desc: "Browse conversations behind each detected action." },
  { section: "Track A · Intelligence", label: "Daily digest", href: "/digest", icon: Bell, status: "soon",
    desc: "A once-a-day summary of what needs your attention." },
  { section: "Track A · Intelligence", label: "AI drafting & summaries", href: "/ai", icon: Sparkles, status: "soon",
    desc: "Draft replies and summarize threads — you always send." },

  // Track B — hosted mail (gated until Track A proves out)
  { section: "Track B · Hosted mail", label: "Webmail", href: "/mail", icon: Mail, status: "soon",
    desc: "Send and receive from your Zoiko mailbox." },
  { section: "Track B · Hosted mail", label: "Domains & DNS", href: "/domains", icon: Globe, status: "soon",
    desc: "Add a domain and verify MX / SPF / DKIM / DMARC." },

  // Team & governance
  { section: "Team & governance", label: "Members & roles", href: "/members", icon: Users, status: "soon",
    desc: "Invite teammates and manage roles." },
  { section: "Team & governance", label: "Policies", href: "/policies", icon: ShieldCheck, status: "soon",
    desc: "Control AI and data-handling policy for the workspace." },
  { section: "Team & governance", label: "Audit log", href: "/audit", icon: FileText, status: "soon",
    desc: "Every privileged and AI action, append-only." },

  // Account
  { section: "Account", label: "Security", href: "/account", icon: KeyRound, status: "live",
    desc: "Change your password and manage sign-in." },
];

// Ordered, de-duplicated section names for grouped rendering.
export const SECTIONS: string[] = NAV.reduce<string[]>((acc, i) => {
  if (!acc.includes(i.section)) acc.push(i.section);
  return acc;
}, []);