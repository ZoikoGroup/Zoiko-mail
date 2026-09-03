"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusBadge, roleBadge, statusBadge } from "@/components/ui/StatusBadge";
import { SearchInput } from "@/components/ui/SearchInput";
import { FilterBar, FilterSelect } from "@/components/ui/FilterBar";
import { DropdownMenu, DropdownItem } from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useMembers, useUpdateMember, useRemoveMember } from "@/lib/owner-hooks";
import { useMe } from "@/lib/auth-hooks";
import { Users, ShieldCheck, UserX, UserCheck, Trash2 } from "lucide-react";

interface UsersTableProps {
  onInvite: () => void;
  onChangeRole: (user: { id: string; name: string; role: string }) => void;
}

export function UsersTable({ onInvite, onChangeRole }: UsersTableProps) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; name: string } | null>(null);

  const { data: meData } = useMe();
  const { data: members = [], isLoading } = useMembers();
  const updateMember = useUpdateMember();
  const removeMember = useRemoveMember();

  const currentUserId = (meData as any)?.user?.id;

  const filtered = members.filter((u) => {
    const matchSearch =
      !search ||
      u.displayName.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase());
    const matchRole = !roleFilter || u.role === roleFilter;
    const matchStatus = !statusFilter || u.status === statusFilter;
    return matchSearch && matchRole && matchStatus;
  });

  function formatDate(d: string | null) {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  const columns = [
    {
      key: "displayName",
      label: "User",
      sortable: true,
      render: (row: any) => (
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-semibold text-white">
            {row.displayName.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
          </span>
          <div>
            <div className="font-medium text-[var(--ink)]">
              {row.displayName}
              {row.userId === currentUserId && <span className="ml-1 text-[var(--ink3)]">(you)</span>}
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
      render: (row: any) => (
        <StatusBadge variant={roleBadge(row.role)}>{row.role}</StatusBadge>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (row: any) => (
        <StatusBadge variant={statusBadge(row.status)} dot>
          {row.status}
        </StatusBadge>
      ),
    },
    {
      key: "joinedAt",
      label: "Joined",
      sortable: true,
      render: (row: any) => <span className="font-mono-num text-[var(--ink3)]">{formatDate(row.joinedAt)}</span>,
    },
    {
      key: "lastActiveAt",
      label: "Last Active",
      sortable: true,
      render: (row: any) => <span className="font-mono-num text-[var(--ink3)]">{formatDate(row.lastActiveAt)}</span>,
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
              { label: "Support", value: "SUPPORT" },
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
        keyExtractor={(row: any) => row.id}
        pageSize={10}
        emptyMessage={isLoading ? "Loading users…" : "No users match your search."}
        actions={(user: any) => {
          const isOwner = user.role === "OWNER";
          const isCurrentUser = user.userId === currentUserId;
          return (
            <DropdownMenu>
              {!isOwner && (
                <DropdownItem onClick={() => onChangeRole({ id: user.id, name: user.displayName, role: user.role })}>
                  <ShieldCheck className="h-3.5 w-3.5" /> Change Role
                </DropdownItem>
              )}
              {!isOwner && user.status === "ACTIVE" && (
                <DropdownItem onClick={() => updateMember.mutate({ id: user.id, input: { status: "SUSPENDED" } })}>
                  <UserX className="h-3.5 w-3.5" /> Suspend
                </DropdownItem>
              )}
              {!isOwner && user.status === "SUSPENDED" && (
                <DropdownItem onClick={() => updateMember.mutate({ id: user.id, input: { status: "ACTIVE" } })}>
                  <UserCheck className="h-3.5 w-3.5" /> Activate
                </DropdownItem>
              )}
              {!isOwner && !isCurrentUser && (
                <DropdownItem danger onClick={() => setConfirmRemove({ id: user.id, name: user.displayName })}>
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

      <ConfirmDialog
        open={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => {
          if (confirmRemove) removeMember.mutate(confirmRemove.id);
          setConfirmRemove(null);
        }}
        title="Remove Member"
        message={`Are you sure you want to remove ${confirmRemove?.name} from the organization?`}
        confirmLabel="Remove"
        variant="danger"
      />
    </div>
  );
}
