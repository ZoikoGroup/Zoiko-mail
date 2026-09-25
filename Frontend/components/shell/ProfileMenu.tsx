"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronRight, LogOut, MonitorSmartphone } from "lucide-react";

import { useLogout, useLogoutAll, useMe } from "@/lib/auth-hooks";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

/**
 * The account menu behind the avatar.
 *
 * Replaces a block that was not a menu at all: the avatar, the name and a
 * permanent "Log out" button sat side by side, and the whole thing was
 * `hidden sm:flex` — so a phone showed no identity and offered no way to
 * sign out.
 *
 * Only personal scope belongs here. Workspace settings, billing and audit
 * are the workspace's, they are already in the nav, and repeating them under
 * somebody's own name blurs "my account" against "this company".
 */

function initials(name?: string, email?: string): string {
  const source = (name ?? email ?? "").trim();
  if (!source) return "?";
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0]![0]! + parts[1]![0]! : source.slice(0, 2)).toUpperCase();
}

function titleCase(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

export function ProfileMenu() {
  const { data: me } = useMe();
  const router = useRouter();
  const logout = useLogout();
  const logoutAll = useLogoutAll();

  const [open, setOpen] = useState(false);
  const [confirmingEverywhere, setConfirmingEverywhere] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  /**
   * Close on Escape and on a click elsewhere, returning focus to the trigger.
   *
   * Not a nicety: at phone width this menu is the only route to signing out,
   * so one that opens and will not dismiss traps the person inside it.
   */
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointer = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  if (!me) return null;

  // Offered only when there is somewhere to go. `/select-workspace` exists and
  // nothing in the product links to it, so somebody in two workspaces has had
  // no way to move between them without signing out.
  const canSwitch = (me.workspaceCount ?? 1) > 1;

  const row =
    "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-[var(--ink)] " +
    "transition-colors hover:bg-[var(--s2)] focus-visible:bg-[var(--s2)] focus-visible:outline-none " +
    "disabled:pointer-events-none disabled:opacity-55";

  return (
    <div className="relative" ref={containerRef}>
      <ConfirmDialog
        open={confirmingEverywhere}
        onClose={() => setConfirmingEverywhere(false)}
        onConfirm={() => {
          setConfirmingEverywhere(false);
          logoutAll.mutate();
        }}
        title="Sign out on every device?"
        message="Every session for this account ends, on every browser and device — including this one. Anyone signed in elsewhere will have to sign in again."
        confirmLabel="Sign out everywhere"
        loading={logoutAll.isPending}
      />

      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className={`flex items-center gap-2 rounded-full py-1 pl-1 pr-1 transition-colors sm:pr-2.5 ${
          open ? "bg-[var(--s2)]" : "hover:bg-[var(--s2)]"
        }`}
      >
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--ai)] text-[11px] font-semibold tracking-wide text-white">
          {initials(me.displayName, me.email)}
        </span>
        {/* The name hides on a phone; the avatar never does, because it is the
            only way to reach sign-out at that width. */}
        <span className="hidden max-w-[12rem] truncate text-[13px] font-medium text-[var(--ink2)] sm:inline">
          {me.displayName}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          /*
            `--surface` and `--sh3`, the tokens the Modal uses. The first
            version reached for `--s1`, which is defined nowhere — so the
            background resolved to nothing and the menu rendered transparent,
            with the page showing straight through it.
          */
          className="absolute right-0 z-50 mt-2 w-[17.5rem] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--sh3)]"
        >
          {/*
            Identity, and nothing here is clickable. The third line earns its
            place: a session is bound to one workspace and an account can hold
            several, so "why can't I see X" is usually the wrong workspace
            rather than the wrong permission.
          */}
          <div className="flex items-start gap-3 border-b border-[var(--border)] px-3.5 py-3.5">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--ai)] text-[13px] font-semibold text-white">
              {initials(me.displayName, me.email)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-semibold leading-tight text-[var(--ink)]">
                {me.displayName}
              </p>
              {/* Truncated rather than wrapped — a long address must not push
                  the menu wider than the button it hangs from. */}
              <p className="mt-0.5 truncate text-[12px] leading-tight text-[var(--ink3)]">
                {me.email}
              </p>
              <span className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent-ink)]">
                <Building2 className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  {titleCase(me.membership.role)} · {me.tenant.name}
                </span>
              </span>
            </div>
          </div>

          {canSwitch && (
            <div className="border-b border-[var(--border)] py-1">
              <button
                type="button"
                role="menuitem"
                className={row}
                onClick={() => {
                  setOpen(false);
                  router.push("/select-workspace");
                }}
              >
                <Building2 className="h-4 w-4 shrink-0 text-[var(--ink3)]" />
                <span className="flex-1">Switch workspace</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--ink3)]" />
              </button>
            </div>
          )}

          <div className="py-1">
            <button
              type="button"
              role="menuitem"
              className={row}
              disabled={logout.isPending}
              onClick={() => {
                setOpen(false);
                logout.mutate();
              }}
            >
              <LogOut className="h-4 w-4 shrink-0 text-[var(--ink3)]" />
              <span>{logout.isPending ? "Signing out…" : "Log out"}</span>
            </button>

            {/*
              `logoutAll` existed and nothing exposed it. For a product where a
              session is the key to a customer's mail, "I signed in on a shared
              machine" needed an answer that was not a support ticket.
              Confirmed first, because it ends this session too.
            */}
            <button
              type="button"
              role="menuitem"
              className={row}
              disabled={logoutAll.isPending}
              onClick={() => {
                setOpen(false);
                setConfirmingEverywhere(true);
              }}
            >
              <MonitorSmartphone className="h-4 w-4 shrink-0 text-[var(--ink3)]" />
              <span className="flex-1">
                {logoutAll.isPending ? "Signing out…" : "Sign out everywhere"}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
