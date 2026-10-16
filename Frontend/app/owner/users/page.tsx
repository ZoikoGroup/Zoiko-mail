"use client";

import { useState } from "react";
import { ProtectedRoute } from "@/components/owner/ProtectedRoute";
import { PageHeader } from "@/components/ui/PageHeader";
import { UsersTable } from "@/components/owner/users/UsersTable";
import { InviteUserModal } from "@/components/owner/users/InviteUserModal";
import { ChangeRoleModal } from "@/components/owner/users/ChangeRoleModal";
import { Modal } from "@/components/ui/Modal";
import { InvitationLinkBox } from "@/components/mailboxes/InvitationLinkBox";
import { useInviteMember, useUpdateMember } from "@/lib/owner-hooks";

export default function UsersPage() {
  const [inviteOpen, setInviteOpen] = useState(false);
  /** The link to pass on, when this deployment cannot email it. In memory only. */
  const [sentInvite, setSentInvite] = useState<{ email: string; link: string } | null>(null);
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
              { email, role: role as "ADMIN" | "MEMBER" | "SUPPORT" },
              {
                onSuccess: (sent) => {
                  setInviteOpen(false);
                  if (sent.invitationLink) setSentInvite({ email, link: sent.invitationLink });
                },
              }
            );
          }}
          loading={inviteMember.isPending}
        />

        <Modal
          open={sentInvite !== null}
          onClose={() => setSentInvite(null)}
          title="Invitation created"
          size="sm"
          footer={
            <button type="button" className="zoiko-btn pri" onClick={() => setSentInvite(null)}>
              Done
            </button>
          }
        >
          {sentInvite && (
            <div className="space-y-2">
              <p className="text-[12.5px] text-[var(--ink2)]">
                The invitation for {sentInvite.email} was created. Email is turned off on this deployment, so nothing was
                sent: copy the link and send it to them yourself.
              </p>
              <InvitationLinkBox link={sentInvite.link} recipient={sentInvite.email} />
            </div>
          )}
        </Modal>

        {roleModalUser && (
          <ChangeRoleModal
            open={!!roleModalUser}
            onClose={() => setRoleModalUser(null)}
            userName={roleModalUser.name}
            currentRole={roleModalUser.role}
            onConfirm={(newRole) => {
              updateMember.mutate(
                { id: roleModalUser.id, input: { role: newRole as "ADMIN" | "MEMBER" | "SUPPORT" } },
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
