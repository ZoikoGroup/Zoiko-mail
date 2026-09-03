"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Mail, UserPlus } from "lucide-react";

interface InviteUserModalProps {
  open: boolean;
  onClose: () => void;
  onInvite: (email: string, role: string) => void;
  loading?: boolean;
}

export function InviteUserModal({ open, onClose, onInvite, loading }: InviteUserModalProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("MEMBER");

  const handleSubmit = () => {
    if (!email.trim()) return;
    onInvite(email.trim(), role);
    setEmail("");
    setRole("MEMBER");
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite User"
      size="sm"
      footer={
        <>
          <button onClick={onClose} className="zoiko-btn" disabled={loading}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="zoiko-btn pri"
            disabled={loading || !email.trim()}
          >
            <UserPlus className="h-3.5 w-3.5" />
            {loading ? "Sending…" : "Send Invitation"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Email Address</label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink3)]" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          >
            <option value="MEMBER">Member — Basic access</option>
            <option value="ADMIN">Admin — Full management access</option>
            <option value="SUPPORT">Support — Read-only diagnostics access</option>
          </select>
        </div>
        <p className="text-[11px] text-[var(--ink3)]">
          An invitation email will be sent. The user will be able to accept and join your organization.
        </p>
      </div>
    </Modal>
  );
}
