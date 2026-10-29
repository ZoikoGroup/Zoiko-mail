"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, HardDrive, Paperclip, RefreshCw, Trash2 } from "lucide-react";
import { WebmailShell } from "@/components/mail/WebmailShell";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ApiError } from "@/lib/api-client";
import { useEmptyTrash } from "@/lib/mail-hooks";
import { formatBytes } from "@/lib/storage-api";
import { useRecalculateStorage, useStorage } from "@/lib/storage-hooks";

const FOLDER_NAMES: Record<string, string> = {
  INBOX: "Inbox",
  SENT: "Sent",
  DRAFTS: "Drafts",
  ARCHIVE: "Archive",
  TRASH: "Trash",
  SPAM: "Spam",
  QUARANTINE: "Quarantine",
};

/** The folders a message link can open (the Mail page's own allow-list). */
const LINKABLE = new Set(["INBOX", "SENT", "ARCHIVE", "TRASH"]);

const folderName = (folder: string) => FOLDER_NAMES[folder] ?? folder;

function message(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "Something went wrong";
}

/** /mail/storage — where the member's mailbox space went. */
export function StoragePage() {
  return (
    <WebmailShell section="storage">
      <StorageBody />
    </WebmailShell>
  );
}

function StorageBody() {
  const { data, isLoading, isError, error, refetch } = useStorage();
  const recalc = useRecalculateStorage();
  const emptyTrash = useEmptyTrash();
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  const trash = data?.folders.find((row) => row.folder === "TRASH");
  const pct = data && data.limitBytes > 0 ? Math.min(100, (data.usedBytes / data.limitBytes) * 100) : 0;
  const barColor = pct >= 95 ? "bg-[var(--crit)]" : pct >= 80 ? "bg-[var(--warn)]" : "bg-[var(--accent)]";
  const biggestFolder = Math.max(1, ...(data?.folders.map((row) => row.bytes) ?? [0]));

  return (
    <div className="h-full overflow-y-auto bg-[var(--ground)]" data-testid="storage-page">
      <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 sm:p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-[var(--ink)]">
              <HardDrive className="h-5 w-5 text-[var(--accent)]" aria-hidden /> Storage
            </h1>
            <p className="mt-1 text-sm text-[var(--ink3)]">
              Where your mailbox space went{data ? ` for ${data.address}` : ""}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => recalc.mutate()}
              disabled={recalc.isPending || isLoading}
              className="zoiko-btn inline-flex items-center gap-1.5"
              title="Count what your mailbox holds and correct the total"
            >
              <RefreshCw className={`h-4 w-4 ${recalc.isPending ? "animate-spin" : ""}`} aria-hidden /> Recalculate
            </button>
            <button
              type="button"
              onClick={() => setConfirmEmpty(true)}
              disabled={!trash || trash.messages === 0 || emptyTrash.isPending}
              className="zoiko-btn inline-flex items-center gap-1.5"
            >
              <Trash2 className="h-4 w-4" aria-hidden /> Empty Trash
            </button>
          </div>
        </header>

        {isError && (
          <div role="alert" className="rounded-xl border border-[var(--crit)]/40 bg-[var(--surface)] p-4 text-sm text-[var(--ink)]">
            Couldn’t load your storage. {message(error)}{" "}
            <button type="button" className="font-medium text-[var(--accent)] underline" onClick={() => refetch()}>
              Retry
            </button>
          </div>
        )}
        {recalc.isError && (
          <div role="alert" className="rounded-xl border border-[var(--crit)]/40 bg-[var(--surface)] p-4 text-sm">
            Couldn’t recalculate. {message(recalc.error)}
          </div>
        )}
        {emptyTrash.isError && (
          <div role="alert" className="rounded-xl border border-[var(--crit)]/40 bg-[var(--surface)] p-4 text-sm">
            Couldn’t empty Trash. {message(emptyTrash.error)}
          </div>
        )}

        <section aria-label="Storage used" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--sh1)]">
          {isLoading || !data ? (
            <div className="zoi-skeleton h-20 rounded-lg" role="status" aria-label="Loading your storage" />
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-3xl font-semibold text-[var(--ink)]" data-testid="storage-used">
                  {formatBytes(data.usedBytes)}
                  <span className="ml-2 text-base font-normal text-[var(--ink3)]">of {formatBytes(data.limitBytes)} used</span>
                </p>
                <p className="text-sm text-[var(--ink3)]">{formatBytes(data.freeBytes)} free · {Math.round(pct)}%</p>
              </div>
              <div
                className="mt-3 h-2.5 overflow-hidden rounded-full bg-[var(--s3)]"
                role="progressbar"
                aria-label="Mailbox storage used"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(pct)}
              >
                <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.max(pct, data.usedBytes > 0 ? 1 : 0)}%` }} />
              </div>
              {data.full ? (
                <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-[var(--crit)]">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  Your mailbox is full. New attachments are refused until you free some space — empty Trash or delete large messages below.
                </p>
              ) : pct >= 80 ? (
                <p className="mt-3 flex items-start gap-2 text-sm text-[var(--warn)]">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  You’re nearly out of space. Empty Trash or delete large messages to make room.
                </p>
              ) : null}
              <p className="mt-3 text-xs text-[var(--ink3)]">
                Every mailbox starts with 5 GB. Need more? Ask your workspace administrator to raise your limit.
              </p>
            </>
          )}
        </section>

        <div className="grid gap-5 md:grid-cols-2">
          <section aria-label="By folder" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 className="text-sm font-semibold text-[var(--ink)]">By folder</h2>
            {isLoading || !data ? (
              <div className="zoi-skeleton mt-3 h-24 rounded-lg" role="status" aria-label="Loading" />
            ) : data.folders.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--ink3)]">Your mailbox is empty.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {data.folders.map((row) => (
                  <li key={row.folder} data-testid="storage-folder">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[var(--ink)]">{folderName(row.folder)}</span>
                      <span className="text-[var(--ink3)]">
                        {row.messages} {row.messages === 1 ? "message" : "messages"} · {formatBytes(row.bytes)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--s3)]">
                      <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${(row.bytes / biggestFolder) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {data && Math.abs(data.itemisedBytes - data.usedBytes) > 1024 && (
              <p className="mt-4 text-xs text-[var(--ink3)]" data-testid="storage-drift">
                The folders add up to {formatBytes(data.itemisedBytes)}, but your total reads {formatBytes(data.usedBytes)}. Choose Recalculate to correct it.
              </p>
            )}
          </section>

          <section aria-label="Attachments" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
              <Paperclip className="h-4 w-4 text-[var(--ink3)]" aria-hidden /> Attachments
            </h2>
            {isLoading || !data ? (
              <div className="zoi-skeleton mt-3 h-24 rounded-lg" role="status" aria-label="Loading" />
            ) : (
              <>
                <p className="mt-3 text-2xl font-semibold text-[var(--ink)]">{formatBytes(data.attachments.bytes)}</p>
                <p className="text-sm text-[var(--ink3)]">
                  in {data.attachments.files} {data.attachments.files === 1 ? "file" : "files"}
                  {data.usedBytes > 0 ? ` · ${Math.round((data.attachments.bytes / Math.max(1, data.itemisedBytes)) * 100)}% of your mail` : ""}
                </p>
              </>
            )}
          </section>
        </div>

        <section aria-label="Largest messages" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <h2 className="text-sm font-semibold text-[var(--ink)]">Largest messages</h2>
          {isLoading || !data ? (
            <div className="zoi-skeleton mt-3 h-24 rounded-lg" role="status" aria-label="Loading" />
          ) : data.largest.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ink3)]">Nothing to show yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--border)]" data-testid="largest-messages">
              {data.largest.map((item) => {
                const body = (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--ink)]">{item.subject || "(no subject)"}</span>
                      <span className="block truncate text-xs text-[var(--ink3)]">
                        {folderName(item.folder)}
                        {item.from ? ` · ${item.from}` : ""} · {new Date(item.date).toLocaleDateString()}
                        {item.attachments > 0 ? ` · ${item.attachments} ${item.attachments === 1 ? "attachment" : "attachments"}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-medium text-[var(--ink2)]">{formatBytes(item.bytes)}</span>
                  </>
                );
                return (
                  <li key={`${item.id}-${item.folder}`}>
                    {LINKABLE.has(item.folder) ? (
                      <Link
                        href={`/mail?message=${item.id}&folder=${item.folder}`}
                        className="flex items-center gap-3 py-2.5 hover:bg-[var(--s2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="flex items-center gap-3 py-2.5">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirmEmpty}
        onClose={() => setConfirmEmpty(false)}
        onConfirm={() => emptyTrash.mutate(undefined, { onSuccess: () => setConfirmEmpty(false) })}
        title="Empty Trash"
        message={`Permanently delete ${trash?.messages ?? 0} ${trash?.messages === 1 ? "message" : "messages"} in Trash and free ${formatBytes(trash?.bytes ?? 0)}? This cannot be undone.`}
        confirmLabel="Empty trash"
        variant="danger"
        loading={emptyTrash.isPending}
      />
    </div>
  );
}
