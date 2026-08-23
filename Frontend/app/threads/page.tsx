"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { MessagesSquare, Search } from "lucide-react";
import {AppShell} from "@/components/shell/AppShell";
import { useThreads } from "@/lib/mail-hooks";
import type { MessageThread } from "@/lib/mail-api";

const PAGE_SIZE = 25;

export default function ThreadsPage() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");

  const { data, isLoading, isError, error } = useThreads({
    page,
    limit: PAGE_SIZE,
    q: activeQuery || undefined,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setActiveQuery(searchInput.trim());
  };

  const clearSearch = () => {
    setSearchInput("");
    setActiveQuery("");
    setPage(1);
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center gap-3">
          <MessagesSquare className="h-6 w-6 text-[var(--accent)]" />
          <h1 className="text-2xl font-semibold text-[var(--ink)]">Threads & messages</h1>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="mb-4 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink3)]" />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search threads by subject or content..."
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] py-2 pl-10 pr-3 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Search
          </button>
          {activeQuery && (
            <button
              type="button"
              onClick={clearSearch}
              className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm text-[var(--ink2)] hover:bg-[var(--surface)]"
            >
              Clear
            </button>
          )}
        </form>

        {activeQuery && (
          <p className="mb-3 text-sm text-[var(--ink2)]">
            Showing results for &quot;{activeQuery}&quot;
          </p>
        )}

        {/* States */}
        {isLoading && (
          <div className="flex min-h-[300px] items-center justify-center text-sm text-[var(--ink3)]">
            Loading threads…
          </div>
        )}

        {isError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            Couldn&apos;t load threads: {(error as Error)?.message ?? "Unknown error"}
          </div>
        )}

        {data && data.threads.length === 0 && (
          <div className="flex min-h-[300px] flex-col items-center justify-center gap-2 text-center">
            <MessagesSquare className="h-10 w-10 text-[var(--ink3)]" />
            <p className="text-sm text-[var(--ink2)]">
              {activeQuery ? "No threads match your search." : "No threads yet."}
            </p>
          </div>
        )}

        {/* Threads list */}
        {data && data.threads.length > 0 && (
          <>
            <ul className="divide-y divide-[var(--line)] rounded-lg border border-[var(--line)] bg-[var(--surface)]">
              {data.threads.map((thread) => (
                <ThreadRow key={thread.id} thread={thread} />
              ))}
            </ul>

            <Pagination
              page={page}
              totalPages={data.pagination.totalPages}
              onPageChange={setPage}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}

// ---- Row -------------------------------------------------------------------

function ThreadRow({ thread }: { thread: MessageThread }) {
  // Backend returns the most recent message as messages[0] in list mode.
  const latest = thread.messages[0];
  const preview =
    latest?.textBody?.slice(0, 140) ?? latest?.subject ?? "(no preview available)";
  const author = latest?.author?.displayName ?? latest?.fromName ?? "Unknown sender";

  return (
    <li>
      <Link
        href={`/threads/${thread.id}`}
        className="block px-4 py-3 hover:bg-[var(--ground)] transition-colors"
      >
        <div className="flex items-baseline justify-between gap-4">
          <p className="truncate font-medium text-[var(--ink)]">
            {thread.subjectNormalized || "(no subject)"}
          </p>
          <span className="shrink-0 text-xs text-[var(--ink3)]">
            {formatDate(thread.lastMessageAt)}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-[var(--ink2)]">
          <span className="truncate">{author}</span>
          <span className="text-[var(--ink3)]">·</span>
          <span className="shrink-0">
            {thread.messageCount} {thread.messageCount === 1 ? "message" : "messages"}
          </span>
        </div>
        {preview && (
          <p className="mt-1 truncate text-sm text-[var(--ink2)]">{preview}</p>
        )}
      </Link>
    </li>
  );
}

// ---- Pagination ------------------------------------------------------------
// Simple numbered pagination. For >7 pages, we window around the current
// page with ellipses so the button row doesn't overflow.

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  const pages = useMemo(() => buildPageWindow(page, totalPages), [page, totalPages]);
  if (totalPages <= 1) return null;

  return (
    <nav className="mt-4 flex items-center justify-center gap-1" aria-label="Pagination">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page === 1}
        className="rounded-md border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--ink2)] hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        Prev
      </button>
      {pages.map((p, i) =>
        p === "…" ? (
          <span key={`e${i}`} className="px-2 text-sm text-[var(--ink3)]">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={`min-w-[36px] rounded-md border px-2 py-1.5 text-sm ${
              p === page
                ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                : "border-[var(--line)] text-[var(--ink2)] hover:bg-[var(--surface)]"
            }`}
          >
            {p}
          </button>
        )
      )}
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page === totalPages}
        className="rounded-md border border-[var(--line)] px-3 py-1.5 text-sm text-[var(--ink2)] hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next
      </button>
    </nav>
  );
}

function buildPageWindow(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const result: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) result.push("…");
  for (let i = start; i <= end; i++) result.push(i);
  if (end < total - 1) result.push("…");
  result.push(total);
  return result;
}

// ---- Helpers ---------------------------------------------------------------

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}