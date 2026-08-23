"use client";

import { Mail, User, Globe, Calendar, HardDrive, Pause, Play, Trash2, X } from "lucide-react";
import type { Mailbox } from "@/lib/owner-api";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatusBadge } from "@/components/ui/StatusBadge";

function formatBytes(mb: number) {
  if (mb === 0) return "—";
  if (mb < 1024) return `${mb} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

interface MailboxDetailsDrawerProps {
  mailbox: Mailbox | null;
  onClose: () => void;
  onSuspend: (m: Mailbox) => void;
  onResume: (m: Mailbox) => void;
  onDelete: (m: Mailbox) => void;
}

export function MailboxDetailsDrawer({ mailbox, onClose, onSuspend, onResume, onDelete }: MailboxDetailsDrawerProps) {
  if (!mailbox) return null;

  const suspended = !!mailbox.sendSuspendedAt;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md border-l border-[var(--border)] bg-[var(--surface)] shadow-[var(--sh3)] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <h2 className="font-editorial text-lg font-semibold text-[var(--ink)]">Mailbox Details</h2>
          <button onClick={onClose} className="rounded-md p-1.5 text-[var(--ink3)] hover:bg-[var(--s2)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 p-5">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-ink)]">
              <Mail className="h-6 w-6" />
            </span>
            <div>
              <p className="font-medium text-[var(--ink)]">{mailbox.displayName}</p>
              <p className="text-sm text-[var(--ink3)]">{mailbox.address}</p>
            </div>
          </div>

          <div className="space-y-3">
            <DetailRow icon={User} label="User" value={mailbox.displayName} />
            <DetailRow icon={Mail} label="Email" value={mailbox.address} />
            <DetailRow icon={Globe} label="Domain" value={mailbox.domain || "—"} />
            <DetailRow
              icon={Calendar}
              label="Created"
              value={fmtDate(mailbox.createdAt)}
            />
            <div className="flex items-start gap-3 py-2">
              <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ink3)]" />
              <div className="flex-1">
                <span className="text-xs font-medium uppercase text-[var(--ink3)]">Storage</span>
                {mailbox.storageLimitMb > 0 ? (
                  <div className="mt-1">
                    <ProgressBar value={mailbox.storageUsedMb} max={mailbox.storageLimitMb} size="sm" />
                    <span className="mt-1 block font-mono-num text-[11px] text-[var(--ink3)]">
                      {formatBytes(mailbox.storageUsedMb)} / {formatBytes(mailbox.storageLimitMb)}
                    </span>
                  </div>
                ) : (
                  <p className="mt-0.5 text-sm text-[var(--ink2)]">—</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 py-2">
              <span className="h-4 w-4 shrink-0" />
              <div>
                <span className="text-xs font-medium uppercase text-[var(--ink3)]">Status</span>
                <div className="mt-0.5">
                  <StatusBadge variant={suspended ? "warn" : "ok"} dot>
                    {suspended ? "Sending Suspended" : "Active"}
                  </StatusBadge>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-4">
            {!suspended ? (
              <button onClick={() => onSuspend(mailbox)} className="zoiko-btn">
                <Pause className="h-3.5 w-3.5" /> Suspend Sending
              </button>
            ) : (
              <button onClick={() => onResume(mailbox)} className="zoiko-btn">
                <Play className="h-3.5 w-3.5" /> Resume Sending
              </button>
            )}
            <button onClick={() => onDelete(mailbox)} className="zoiko-btn crit">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function DetailRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <Icon className="h-4 w-4 shrink-0 text-[var(--ink3)]" />
      <div>
        <span className="text-xs font-medium uppercase text-[var(--ink3)]">{label}</span>
        <p className="text-sm text-[var(--ink)]">{value}</p>
      </div>
    </div>
  );
}
