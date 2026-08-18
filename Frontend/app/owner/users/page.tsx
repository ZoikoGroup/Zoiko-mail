"use client";

import { useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { UsersTable } from "@/components/owner/users/UsersTable";
import { InviteUserModal } from "@/components/owner/users/InviteUserModal";
import { ChangeRoleModal } from "@/components/owner/users/ChangeRoleModal";
import { useInviteMember, useUpdateMember } from "@/lib/owner-hooks";

export default function UsersPage() {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleModalUser, setRoleModalUser] = useState<{ id: string; name: string; role: string } | null>(null);

  const inviteMember = useInviteMember();
  const updateMember = useUpdateMember();

  return (
    <ProtectedRoute>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Users & Roles"
          description="Manage team members and their access levels."
        />
        <UsersTable
          onInvite={() => setInviteOpen(true)}
          onChangeRole={(user) => setRoleModalUser(user)}
        />

        <InviteUserModal
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          onInvite={(email, role) => {
            inviteMember.mutate(
              { email, role: role as "ADMIN" | "MEMBER" },
              { onSuccess: () => setInviteOpen(false) }
            );
          }}
          loading={inviteMember.isPending}
        />

        {roleModalUser && (
          <ChangeRoleModal
            open={!!roleModalUser}
            onClose={() => setRoleModalUser(null)}
            userName={roleModalUser.name}
            currentRole={roleModalUser.role}
            onConfirm={(newRole) => {
              updateMember.mutate(
                { id: roleModalUser.id, input: { role: newRole as "ADMIN" | "MEMBER" } },
                { onSuccess: () => setRoleModalUser(null) }
              );
            }}
            loading={updateMember.isPending}
          />
        )}
      </div>
    </ProtectedRoute>
  );
}
