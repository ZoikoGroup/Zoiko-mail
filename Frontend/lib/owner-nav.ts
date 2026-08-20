import {
  LayoutDashboard,
  Users,
  Mail,
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

  { section: "Workspace", label: "Users & Roles", href: "/owner/users", icon: Users },
  { section: "Workspace", label: "Mailboxes", href: "/owner/mailboxes", icon: Mail },
  { section: "Workspace", label: "Connected Accounts", href: "/owner/connected-accounts", icon: Link2 },

  { section: "Organization", label: "Organization Settings", href: "/owner/organization-settings", icon: Settings, ownerOnly: true },
  { section: "Organization", label: "Domains", href: "/owner/domains", icon: Globe, ownerOnly: true },
  { section: "Organization", label: "Subscription & Billing", href: "/owner/billing", icon: CreditCard, ownerOnly: true },

  { section: "Security", label: "Audit Logs", href: "/owner/audit-logs", icon: FileText, ownerOnly: true },
  { section: "Security", label: "Security Alerts", href: "/owner/security-alerts", icon: ShieldAlert, ownerOnly: true },
  { section: "Security", label: "Policies", href: "/owner/policies", icon: ShieldCheck, ownerOnly: true },

  { section: "Data Management", label: "Export Data", href: "/owner/export-data", icon: Download, ownerOnly: true },
  { section: "Data Management", label: "Deletion Requests", href: "/owner/deletion-requests", icon: Trash2, ownerOnly: true },

  { section: "Settings", label: "General Settings", href: "/owner/general-settings", icon: Sliders },
  { section: "Settings", label: "Profile", href: "/owner/profile", icon: UserCircle },
];

export const OWNER_SECTIONS: string[] = OWNER_NAV.reduce<string[]>((acc, item) => {
  if (!acc.includes(item.section)) acc.push(item.section);
  return acc;
}, []);
