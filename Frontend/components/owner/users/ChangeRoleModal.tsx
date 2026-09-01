"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { ShieldCheck } from "lucide-react";

interface ChangeRoleModalProps {
  open: boolean;
  onClose: () => void;
  userName: string;
  currentRole: string;
  onConfirm: (newRole: string) => void;
  loading?: boolean;
}

export function ChangeRoleModal({
  open,
  onClose,
  userName,
  currentRole,
  onConfirm,
  loading,
}: ChangeRoleModalProps) {
  const [role, setRole] = useState(currentRole);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change Role"
      size="sm"
      footer={
        <>
          <button onClick={onClose} className="zoiko-btn" disabled={loading}>
            Cancel
          </button>
          <button
            onClick={() => onConfirm(role)}
            className="zoiko-btn pri"
            disabled={loading || role === currentRole}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {loading ? "Updating…" : "Update Role"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--ink2)]">
          Changing role for <span className="font-medium text-[var(--ink)]">{userName}</span>
        </p>
        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">New Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          >
            <option value="ADMIN">Admin — Full management access</option>
            <option value="MEMBER">Member — Basic access</option>
            <option value="SUPPORT">Support — Read-only diagnostics access</option>
          </select>
        </div>
        <div className="rounded-lg bg-[var(--s2)] p-3 text-[11px] text-[var(--ink3)]">
          <strong className="text-[var(--ink2)]">Admin:</strong> Can manage users, domains, mailboxes, and policies.
          <br />
          <strong className="text-[var(--ink2)]">Member:</strong> Can use mail and connected accounts but cannot manage organization settings.
          <br />
          <strong className="text-[var(--ink2)]">Support:</strong> Read-only diagnostics within this workspace. Cannot manage users or settings.
        </div>
      </div>
    </Modal>
  );
}
