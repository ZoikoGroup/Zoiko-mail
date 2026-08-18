"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusBadge, roleBadge, statusBadge } from "@/components/ui/StatusBadge";
import { SearchInput } from "@/components/ui/SearchInput";
import { FilterBar, FilterSelect } from "@/components/ui/FilterBar";
import { DropdownMenu, DropdownItem } from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { Users, ShieldCheck, UserX, UserCheck, Trash2 } from "lucide-react";

interface UserRow {
  id: string;
  displayName: string;
  email: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  status: "ACTIVE" | "INVITED" | "SUSPENDED";
  joinedAt: string;
  lastActiveAt: string | null;
  isCurrentUser?: boolean;
}

const mockUsers: UserRow[] = [
  { id: "u1", displayName: "Alex Morgan", email: "alex@zoiko.dev", role: "OWNER", status: "ACTIVE", joinedAt: "2026-06-01T00:00:00Z", lastActiveAt: "2026-08-18T09:00:00Z", isCurrentUser: true },
  { id: "u2", displayName: "Sarah Chen", email: "sarah@zoiko.dev", role: "ADMIN", status: "ACTIVE", joinedAt: "2026-06-05T00:00:00Z", lastActiveAt: "2026-08-18T08:30:00Z" },
  { id: "u3", displayName: "Jordan Patel", email: "jordan@zoiko.dev", role: "MEMBER", status: "ACTIVE", joinedAt: "2026-06-10T00:00:00Z", lastActiveAt: "2026-08-17T17:00:00Z" },
  { id: "u4", displayName: "Jamie Lee", email: "jamie@zoiko.dev", role: "ADMIN", status: "ACTIVE", joinedAt: "2026-06-15T00:00:00Z", lastActiveAt: "2026-08-17T14:00:00Z" },
  { id: "u5", displayName: "Taylor Kim", email: "taylor@zoiko.dev", role: "MEMBER", status: "ACTIVE", joinedAt: "2026-07-01T00:00:00Z", lastActiveAt: "2026-08-16T10:00:00Z" },
  { id: "u6", displayName: "Casey Brooks", email: "casey@zoiko.dev", role: "MEMBER", status: "SUSPENDED", joinedAt: "2026-07-10T00:00:00Z", lastActiveAt: null },
  { id: "u7", displayName: "Morgan Davis", email: "morgan@zoiko.dev", role: "MEMBER", status: "INVITED", joinedAt: "2026-08-18T09:00:00Z", lastActiveAt: null },
  { id: "u8", displayName: "Riley Zhang", email: "riley@zoiko.dev", role: "MEMBER", status: "INVITED", joinedAt: "2026-08-17T15:00:00Z", lastActiveAt: null },
  { id: "u9", displayName: "Sam Wilson", email: "sam@zoiko.dev", role: "MEMBER", status: "INVITED", joinedAt: "2026-08-16T11:00:00Z", lastActiveAt: null },
];

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface UsersTableProps {
  onInvite: () => void;
}

export function UsersTable({ onInvite }: UsersTableProps) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [actionUser, setActionUser] = useState<UserRow | null>(null);

  const filtered = mockUsers.filter((u) => {
    const matchSearch =
      !search ||
      u.displayName.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase());
    const matchRole = !roleFilter || u.role === roleFilter;
    const matchStatus = !statusFilter || u.status === statusFilter;
    return matchSearch && matchRole && matchStatus;
  });

  const columns: Column<UserRow>[] = [
    {
      key: "displayName",
      label: "User",
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-semibold text-white">
            {row.displayName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
          </span>
          <div>
            <div className="font-medium text-[var(--ink)]">
              {row.displayName}
              {row.isCurrentUser && <span className="ml-1 text-[var(--ink3)]">(you)</span>}
            </div>
            <div className="text-[11px] text-[var(--ink3)]">{row.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      label: "Role",
      sortable: true,
      render: (row) => (
        <StatusBadge variant={roleBadge(row.role)}>{row.role}</StatusBadge>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (row) => (
        <StatusBadge variant={statusBadge(row.status)} dot>
          {row.status}
        </StatusBadge>
      ),
    },
    {
      key: "joinedAt",
      label: "Joined",
      sortable: true,
      render: (row) => <span className="font-mono-num text-[var(--ink3)]">{formatDate(row.joinedAt)}</span>,
    },
    {
      key: "lastActiveAt",
      label: "Last Active",
      sortable: true,
      render: (row) => <span className="font-mono-num text-[var(--ink3)]">{formatDate(row.lastActiveAt)}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterBar>
          <SearchInput
            placeholder="Search users…"
            value={search}
            onChange={setSearch}
            className="w-64"
          />
          <FilterSelect
            label="Role"
            value={roleFilter}
            onChange={setRoleFilter}
            options={[
              { label: "Owner", value: "OWNER" },
              { label: "Admin", value: "ADMIN" },
              { label: "Member", value: "MEMBER" },
            ]}
          />
          <FilterSelect
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { label: "Active", value: "ACTIVE" },
              { label: "Invited", value: "INVITED" },
              { label: "Suspended", value: "SUSPENDED" },
            ]}
          />
        </FilterBar>
        <button onClick={onInvite} className="zoiko-btn pri">
          <Users className="h-3.5 w-3.5" />
          Invite User
        </button>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        keyExtractor={(row) => row.id}
        pageSize={10}
        emptyMessage="No users match your search."
        actions={(user) => {
          const isOwner = user.role === "OWNER";
          return (
            <DropdownMenu>
              {!isOwner && (
                <DropdownItem onClick={() => setActionUser(user)}>
                  <ShieldCheck className="h-3.5 w-3.5" /> Change Role
                </DropdownItem>
              )}
              {!isOwner && user.status === "ACTIVE" && (
                <DropdownItem onClick={() => {}}>
                  <UserX className="h-3.5 w-3.5" /> Suspend
                </DropdownItem>
              )}
              {!isOwner && user.status === "SUSPENDED" && (
                <DropdownItem onClick={() => {}}>
                  <UserCheck className="h-3.5 w-3.5" /> Activate
                </DropdownItem>
              )}
              {!isOwner && (
                <DropdownItem danger onClick={() => {}}>
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </DropdownItem>
              )}
              {isOwner && (
                <DropdownItem disabled>
                  <ShieldCheck className="h-3.5 w-3.5" /> Primary Owner
                </DropdownItem>
              )}
            </DropdownMenu>
          );
        }}
      />
    </div>
  );
}
