"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Mail, Sparkles } from "lucide-react";

interface CreateMailboxModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { email: string; displayName: string; type: string }) => void;
  loading?: boolean;
}

export function CreateMailboxModal({ open, onClose, onSubmit, loading }: CreateMailboxModalProps) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [type, setType] = useState("PRIMARY");

  const handleSubmit = () => {
    if (!email.trim() || !displayName.trim()) return;
    onSubmit({ email: email.trim(), displayName: displayName.trim(), type });
    setEmail("");
    setDisplayName("");
    setType("PRIMARY");
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create Mailbox"
      size="sm"
      footer={
        <>
          <button onClick={onClose} className="zoiko-btn" disabled={loading}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="zoiko-btn pri"
            disabled={loading || !email.trim() || !displayName.trim()}
          >
            <Mail className="h-3.5 w-3.5" />
            {loading ? "Creating…" : "Create Mailbox"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="John Smith"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Email Address</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@yourdomain.com"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Mailbox Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          >
            <option value="PRIMARY">Primary — Main mailbox for a user</option>
            <option value="SHARED">Shared — Team/department mailbox</option>
          </select>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-[var(--ai-soft)] px-3 py-2 text-[11px] text-[var(--ai)]">
          <Sparkles className="h-3.5 w-3.5" />
          AI features can be enabled after mailbox creation.
        </div>
      </div>
    </Modal>
  );
}
