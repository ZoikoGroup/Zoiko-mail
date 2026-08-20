"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Mail, UserPlus } from "lucide-react";

interface Member {
  id: string;
  displayName: string;
  email: string;
}

interface CreateMailboxModalProps {
  open: boolean;
  onClose: () => void;
  members: Member[];
  onSubmit: (membershipId: string) => void;
  loading?: boolean;
}

export function CreateMailboxModal({ open, onClose, members, onSubmit, loading }: CreateMailboxModalProps) {
  const [selectedId, setSelectedId] = useState("");

  const selectedMember = members.find((m) => m.id === selectedId);

  const handleSubmit = () => {
    if (!selectedId) return;
    onSubmit(selectedId);
    setSelectedId("");
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Provision Mailbox"
      size="sm"
      footer={
        <>
          <button onClick={onClose} className="zoiko-btn" disabled={loading}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="zoiko-btn pri"
            disabled={loading || !selectedId}
          >
            <Mail className="h-3.5 w-3.5" />
            {loading ? "Creating…" : "Create Mailbox"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {members.length === 0 ? (
          <div className="rounded-lg bg-[var(--s2)] p-4 text-center text-sm text-[var(--ink3)]">
            All active members already have mailboxes.
          </div>
        ) : (
          <>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Select Member</label>
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              >
                <option value="">Choose a member…</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} ({m.email})
                  </option>
                ))}
              </select>
            </div>
            {selectedMember && (
              <div className="rounded-lg bg-[var(--s2)] p-3 text-[11px] text-[var(--ink3)]">
                <strong className="text-[var(--ink2)]">Mailbox address:</strong> {selectedMember.email}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
