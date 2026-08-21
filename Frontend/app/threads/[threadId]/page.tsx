"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, MessagesSquare, Paperclip } from "lucide-react";
import {AppShell} from "@/components/shell/AppShell";
import { useThread } from "@/lib/mail-hooks";
import { downloadAttachment } from "@/lib/mail-api";
import type { EmailMessage, MailAttachment } from "@/lib/mail-api";

export default function ThreadDetailPage() {
  const params = useParams();
  const router = useRouter();
  const threadId = typeof params?.threadId === "string" ? params.threadId : null;

  const { data: thread, isLoading, isError, error } = useThread(threadId);

  const handleAttachmentClick = useCallback(
    async (message: EmailMessage, attachment: MailAttachment) => {
      try {
        await downloadAttachment(message.id, attachment);
      } catch (e) {
        console.error("Attachment download failed", e);
      }
    },
    []
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Back link */}
        <button
          onClick={() => router.push("/threads")}
          className="mb-4 inline-flex items-center gap-2 text-sm text-[var(--ink2)] hover:text-[var(--accent)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to threads
        </button>

        {isLoading && (
          <div className="flex min-h-[300px] items-center justify-center text-sm text-[var(--ink3)]">
            Loading thread…
          </div>
        )}

        {isError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            Couldn&apos;t load thread: {(error as Error)?.message ?? "Unknown error"}
          </div>
        )}

        {thread && (
          <>
            {/* Thread header */}
            <div className="mb-6 flex items-start gap-3">
              <MessagesSquare className="mt-1 h-6 w-6 shrink-0 text-[var(--accent)]" />
              <div className="min-w-0 flex-1">
                <h1 className="break-words text-2xl font-semibold text-[var(--ink)]">
                  {thread.subjectNormalized || "(no subject)"}
                </h1>
                <p className="mt-1 text-sm text-[var(--ink2)]">
                  {thread.messageCount}{" "}
                  {thread.messageCount === 1 ? "message" : "messages"}
                </p>
              </div>
            </div>

            {/* Messages, chronological (backend returns them createdAt: asc) */}
            <ul className="space-y-3">
              {thread.messages.map((message) => (
                <MessageCard
                  key={message.id}
                  message={message}
                  onAttachmentClick={handleAttachmentClick}
                />
              ))}
            </ul>

            {thread.messages.length === 0 && (
              <p className="text-sm text-[var(--ink3)]">
                This thread has no visible messages in your mailbox.
              </p>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

// ---- Message card ----------------------------------------------------------

function MessageCard({
  message,
  onAttachmentClick,
}: {
  message: EmailMessage;
  onAttachmentClick: (m: EmailMessage, a: MailAttachment) => void;
}) {
  const author = message.author?.displayName || message.fromName || "Unknown sender";
  const authorEmail = message.author?.email || message.fromAddress || "";

  const to = message.recipients.filter((r) => r.type === "TO").map((r) => r.email);
  const cc = message.recipients.filter((r) => r.type === "CC").map((r) => r.email);
  const bcc = message.recipients.filter((r) => r.type === "BCC").map((r) => r.email);

  return (
    <li className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
      {/* From / To / date */}
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-[var(--ink)]">
            {author}
            {authorEmail && (
              <span className="ml-2 font-normal text-[var(--ink3)]">
                &lt;{authorEmail}&gt;
              </span>
            )}
          </p>
          {to.length > 0 && (
            <p className="mt-0.5 text-xs text-[var(--ink2)]">
              To: {to.join(", ")}
            </p>
          )}
          {cc.length > 0 && (
            <p className="mt-0.5 text-xs text-[var(--ink2)]">
              Cc: {cc.join(", ")}
            </p>
          )}
          {bcc.length > 0 && (
            <p className="mt-0.5 text-xs text-[var(--ink2)]">
              Bcc: {bcc.join(", ")}
            </p>
          )}
        </div>
        <span className="shrink-0 text-xs text-[var(--ink3)]">
          {formatFullDate(message.sentAt ?? message.createdAt)}
        </span>
      </div>

      {/* Body */}
      <div className="text-sm text-[var(--ink)]">
        {message.textBody ? (
          <pre className="whitespace-pre-wrap break-words font-sans">
            {message.textBody}
          </pre>
        ) : message.htmlBody ? (
          // Rendering raw HTML is a security risk (XSS). Show a note instead
          // until we integrate a sanitizer like DOMPurify.
          <p className="italic text-[var(--ink3)]">
            (HTML-only message — text preview not available)
          </p>
        ) : (
          <p className="italic text-[var(--ink3)]">(no content)</p>
        )}
      </div>

      {/* Attachments */}
      {message.attachments.length > 0 && (
        <div className="mt-3 border-t border-[var(--line)] pt-3">
          <p className="mb-2 text-xs font-medium uppercase text-[var(--ink3)]">
            Attachments
          </p>
          <ul className="flex flex-wrap gap-2">
            {message.attachments.map((att) => (
              <li key={att.id}>
                <button
                  onClick={() => onAttachmentClick(message, att)}
                  className="inline-flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--ground)] px-3 py-1.5 text-xs text-[var(--ink2)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  <span>{att.fileName}</span>
                  <span className="text-[var(--ink3)]">
                    ({formatBytes(att.sizeBytes)})
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

// ---- Helpers ---------------------------------------------------------------

function formatFullDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}