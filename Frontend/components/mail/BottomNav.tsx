"use client";

import Link from "next/link";
import { Mail, Star, Link2, Settings } from "lucide-react";
import type { MailListFolder } from "@/lib/mail-api";

/**
 * Mail and Starred switch folder in place (no navigation — this is the
 * design's bottom nav for the webmail app itself). Contacts and Settings
 * leave /mail entirely; they're separate pages that still use AppShell.
 */
export function BottomNav({
  folder,
  onFolderChange,
}: {
  folder: MailListFolder;
  onFolderChange: (folder: MailListFolder) => void;
}) {
  const items: { key: MailListFolder; label: string; icon: typeof Mail }[] = [
    { key: "INBOX", label: "Mail", icon: Mail },
    { key: "STARRED", label: "Starred", icon: Star },
  ];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 flex items-stretch border-t border-[var(--border)] bg-[var(--surface)] lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active = folder === item.key;
        return (
          <button
            key={item.key}
            onClick={() => onFolderChange(item.key)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
              active ? "text-[var(--accent-ink)]" : "text-[var(--ink3)]"
            }`}
          >
            <Icon className={`h-5 w-5 ${active ? "fill-[var(--accent-soft)]" : ""}`} />
            {item.label}
          </button>
        );
      })}
      <Link
        href="/contacts"
        className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-[var(--ink3)]"
      >
        <Link2 className="h-5 w-5" />
        Contacts
      </Link>
      <Link
        href="/settings"
        className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-[var(--ink3)]"
      >
        <Settings className="h-5 w-5" />
        Settings
      </Link>
    </nav>
  );
}