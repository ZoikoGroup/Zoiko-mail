"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { OWNER_NAV } from "@/lib/owner-nav";

interface GlobalSearchProps {
  className?: string;
}

const searchIndex = OWNER_NAV.map((item) => ({
  href: item.href,
  label: item.label,
  section: item.section,
  keywords: `${item.label} ${item.section}`.toLowerCase(),
}));

export function GlobalSearch({ className = "" }: GlobalSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = query.trim()
    ? searchIndex.filter((item) =>
        item.keywords.includes(query.trim().toLowerCase())
      )
    : [];

  const visibleResults = results.slice(0, 8);

  useEffect(() => {
    setHighlightIdx(0);
  }, [query]);

  const navigate = useCallback(
    (href: string) => {
      router.push(href);
      setQuery("");
      setOpen(false);
      inputRef.current?.blur();
    },
    [router]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, visibleResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && visibleResults[highlightIdx]) {
      e.preventDefault();
      navigate(visibleResults[highlightIdx].href);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink3)]" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKeyDown}
        placeholder="Search pages…"
        className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--s2)] pl-8 pr-7 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
      />
      {query && (
        <button
          onClick={() => {
            setQuery("");
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ink3)] hover:text-[var(--ink2)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {open && query.trim() && (
        <div
          ref={listRef}
          className="absolute top-full z-50 mt-1 w-full min-w-[240px] rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[var(--sh2)]"
        >
          {visibleResults.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-[var(--ink3)]">
              No matching pages found.
            </div>
          ) : (
            visibleResults.map((item, i) => (
              <button
                key={item.href}
                onMouseDown={(e) => {
                  e.preventDefault();
                  navigate(item.href);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                  i === highlightIdx
                    ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]"
                    : "text-[var(--ink2)] hover:bg-[var(--s2)]"
                }`}
              >
                <span className="flex-1 truncate">{item.label}</span>
                <span className="text-[10px] text-[var(--ink3)]">{item.section}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
