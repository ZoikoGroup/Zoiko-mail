import {
  LayoutDashboard,
  Users,
  Mail,
  Inbox,
  Link2,
  Settings,
  Globe,
  CreditCard,
  FileText,
  ShieldAlert,
  ShieldCheck,
  Download,
  Trash2,
  Sliders,
  UserCircle,
  BarChart3,
  Activity,
  Webhook,
  Ban,
  KeyRound,
  type LucideIcon,
} from "lucide-react";

export type NavStatus = "live" | "soon";

export interface OwnerNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  section: string;
  ownerOnly?: boolean;
}

export const OWNER_NAV: OwnerNavItem[] = [
  { section: "Dashboard", label: "Overview", href: "/owner", icon: LayoutDashboard },
  { section: "Dashboard", label: "Usage", href: "/owner/usage", icon: BarChart3 },
  { section: "Dashboard", label: "Delivery Events", href: "/owner/delivery-events", icon: Activity, ownerOnly: true },
  { section: "Dashboard", label: "Provider Events", href: "/owner/provider-events", icon: Webhook, ownerOnly: true },

  { section: "Workspace", label: "Users & Roles", href: "/owner/users", icon: Users },
  { section: "Workspace", label: "Mailboxes", href: "/owner/mailboxes", icon: Mail },
  { section: "Workspace", label: "Inbox", href: "/owner/inbox", icon: Inbox },
  { section: "Workspace", label: "Connected Accounts", href: "/owner/connected-accounts", icon: Link2 },

  { section: "Organization", label: "Organization Settings", href: "/owner/organization-settings", icon: Settings, ownerOnly: true },
  { section: "Organization", label: "Domains", href: "/owner/domains", icon: Globe, ownerOnly: true },
  // Owner-only: RBAC §2 records "Approve support access" as Owner Yes,
  // Admin No. An Admin can still decline a request from the same screen.
  { section: "Organization", label: "Support Access", href: "/owner/support-access", icon: ShieldCheck, ownerOnly: true },
  { section: "Organization", label: "Subscription & Billing", href: "/owner/billing", icon: CreditCard, ownerOnly: true },

  { section: "Security", label: "Audit Logs", href: "/owner/audit-logs", icon: FileText, ownerOnly: true },
  // The decision queue that sits beside the log. ownerOnly to match the rest
  // of this section — an Admin holds the capability and reaches the same
  // alerts through their own console.
  { section: "Security", label: "Security Alerts", href: "/owner/security-alerts", icon: ShieldAlert, ownerOnly: true },
  { section: "Security", label: "Policies", href: "/owner/policies", icon: ShieldCheck, ownerOnly: true },
  { section: "Security", label: "Suppressions", href: "/owner/suppressions", icon: Ban, ownerOnly: true },

  { section: "Data Management", label: "Export Data", href: "/owner/export-data", icon: Download, ownerOnly: true },
  { section: "Data Management", label: "Deletion Requests", href: "/owner/deletion-requests", icon: Trash2, ownerOnly: true },

  { section: "Settings", label: "General Settings", href: "/owner/general-settings", icon: Sliders },
  { section: "Settings", label: "Profile", href: "/owner/profile", icon: UserCircle },
];

export const OWNER_SECTIONS: string[] = OWNER_NAV.reduce<string[]>((acc, item) => {
  if (!acc.includes(item.section)) acc.push(item.section);
  return acc;
}, []);
