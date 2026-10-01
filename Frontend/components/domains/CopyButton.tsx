"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Copies a record's host or value; says so for a moment, then resets. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${label}`}
      className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-[var(--ink3)] hover:bg-[var(--s3)] hover:text-[var(--ink)]"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-[var(--ok)]" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
