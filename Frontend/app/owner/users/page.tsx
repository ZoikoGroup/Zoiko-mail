"use client";

import { useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { UsersTable } from "@/components/owner/users/UsersTable";
import { InviteUserModal } from "@/components/owner/users/InviteUserModal";
import { ChangeRoleModal } from "@/components/owner/users/ChangeRoleModal";

export default function UsersPage() {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleModalUser, setRoleModalUser] = useState<{ name: string; role: string } | null>(null);

  return (
    <ProtectedRoute>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <PageHeader
          title="Users & Roles"
          description="Manage team members and their access levels."
        />
        <UsersTable onInvite={() => setInviteOpen(true)} />

        <InviteUserModal
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          onInvite={(email, role) => {
            // TODO: wire to useInviteMember mutation
            console.log("Invite:", email, role);
            setInviteOpen(false);
          }}
        />

        {roleModalUser && (
          <ChangeRoleModal
            open={!!roleModalUser}
            onClose={() => setRoleModalUser(null)}
            userName={roleModalUser.name}
            currentRole={roleModalUser.role}
            onConfirm={(newRole) => {
              // TODO: wire to useUpdateMember mutation
              console.log("Change role:", roleModalUser.name, newRole);
              setRoleModalUser(null);
            }}
          />
        )}
      </div>
    </ProtectedRoute>
  );
}
