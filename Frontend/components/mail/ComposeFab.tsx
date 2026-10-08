"use client";

import { Pencil } from "lucide-react";

/** Fixed bottom-right, above BottomNav. Mobile only — desktop has the
 * Compose button at the top of FolderRail instead. */
export function ComposeFab({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-[var(--sh3)] lg:hidden"
      style={{ bottom: "calc(5rem + env(safe-area-inset-bottom, 0px))" }}
      aria-label="Compose"
    >
      <Pencil className="h-5 w-5" />
    </button>
  );
}