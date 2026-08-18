import {
  LayoutDashboard,
  Users,
  MailPlus,
  Mail,
  Globe,
  UsersRound,
  KeyRound,
  ShieldCheck,
  RefreshCw,
  FileText,
  Bell,
  Settings,
  Inbox,
  CheckSquare,
  type LucideIcon,
} from "lucide-react";
import type { Capability } from "./capabilities";

/**
 * Admin workspace navigation.
 *
 * Grouped as the role prototype specifies — Workspace / Trust & access /
 * System / My work — and filtered by capability rather than by role. An item the
 * caller lacks the capability for is absent, not disabled; the route also
 * re-checks server-side, because hiding a link is not access control.
 *
 * Owner-only destinations (Billing, Subscription, Usage analytics, Tenant
 * management, Export data, Delete tenant, Support access history) are not listed
 * here at all: they belong to the Owner workspace.
 */
export interface AdminNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Omitted for items every member of the workspace can reach. */
  capability?: Capability;
  /** Rail badge. */
  count?: number;
  /** Renders the badge in a warning tone — something needs attention. */
  attention?: boolean;
  /** Not yet built; shown but not linked, matching the existing rail idiom. */
  soon?: boolean;
}

export interface AdminNavGroup {
  group: string;
  items: AdminNavItem[];
}

export const ADMIN_NAV: AdminNavGroup[] = [
  {
    group: "Workspace",
    items: [
      { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
      { label: "Users", href: "/admin/users", icon: Users, capability: "people.read", count: 14 },
      { label: "Invitations", href: "/admin/invitations", icon: MailPlus, capability: "people.invite.member", count: 3, attention: true },
      { label: "Mailboxes", href: "/admin/mailboxes", icon: Mail, capability: "workspace.mailboxes.manage", count: 11 },
      { label: "Domains", href: "/admin/domains", icon: Globe, capability: "workspace.domains.manage", count: 2 },
      { label: "Groups", href: "/admin/groups", icon: UsersRound, capability: "workspace.groups.manage", count: 4 },
    ],
  },
  {
    group: "Trust & access",
    items: [
      { label: "Roles & permissions", href: "/admin/permissions", icon: KeyRound },
      { label: "Policies", href: "/admin/policies", icon: ShieldCheck, capability: "policy.write" },
      { label: "Provider sync", href: "/admin/provider-sync", icon: RefreshCw },
      { label: "Audit logs", href: "/admin/audit", icon: FileText, capability: "audit.read" },
    ],
  },
  {
    group: "System",
    items: [
      { label: "Notifications", href: "/admin/notifications", icon: Bell, count: 4 },
      { label: "Workspace settings", href: "/admin/settings", icon: Settings, capability: "workspace.settings.read" },
    ],
  },
  {
    group: "My work",
    items: [
      // An Admin has a mailbox like any Member. These render the same components
      // the member routes use, but inside the admin shell — following a rail item
      // must never eject an Admin into the member workspace.
      { label: "Inbox", href: "/admin/inbox", icon: Inbox, capability: "mail.own.rw", count: 12 },
      { label: "Commitments", href: "/admin/commitments", icon: CheckSquare, capability: "commitments.own.manage", count: 7 },
    ],
  },
];

/** Drops groups that end up empty once capabilities are applied. */
export function visibleNav(can: (capability: Capability) => boolean): AdminNavGroup[] {
  return ADMIN_NAV.map((group) => ({
    group: group.group,
    items: group.items.filter((item) => !item.capability || can(item.capability)),
  })).filter((group) => group.items.length > 0);
}
