"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, LogOut, MonitorSmartphone } from "lucide-react";

import { useLogout, useLogoutAll, useMe } from "@/lib/auth-hooks";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

/**
 * The account menu behind the avatar.
 *
 * Replaces a block that was not a menu at all: the avatar and name were
 * static text with a permanent "Log out" button beside them, and the whole
 * thing was `hidden sm:flex` — so on a phone there was no identity on screen
 * and no way to sign out.
 *
 * Three things earn their place here, and nothing else does. Workspace
 * settings, billing and audit are workspace scope and already in the nav;
 * duplicating them blurs "my account" against "this company".
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
   * Close on Escape and on a click elsewhere.
   *
   * Not decoration: this menu is the only route to signing out on a phone,
   * so one that can be opened and not dismissed traps the person inside it.
   * Focus returns to the trigger so a keyboard user is not dropped at the
   * top of the document.
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

  // Offered only when there is somewhere to go. `/select-workspace` exists but
  // nothing in the product links to it, so a person in two workspaces has had
  // no way to move between them without signing out.
  const canSwitch = (me.workspaceCount ?? 1) > 1;

  const item =
    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] text-[var(--ink)] hover:bg-[var(--s2)] disabled:opacity-60";

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
        message="Every session for this account ends, on every browser and device — including this one. Anyone using it will have to sign in again."
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
        className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-[var(--s2)]"
      >
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--ai)] text-xs font-semibold text-white">
          {initials(me.displayName, me.email)}
        </span>
        {/* The name hides on a phone; the avatar never does, because it is
            the only way to reach sign-out there. */}
        <span className="hidden text-sm text-[var(--ink2)] sm:inline">{me.displayName}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--s1)] shadow-lg"
        >
          {/*
            Identity, and not a menu item — nothing here is clickable.
            The third line is the one that earns its place: sessions are bound
            to one workspace, and "why can't I see X" is usually the wrong
            workspace rather than the wrong permission.
          */}
          <div className="border-b border-[var(--border)] px-3 py-3">
            <p className="truncate text-[13px] font-semibold text-[var(--ink)]">
              {me.displayName}
            </p>
            <p className="truncate text-[12px] text-[var(--ink3)]">{me.email}</p>
            <p className="mt-1 truncate text-[11.5px] text-[var(--ink2)]">
              {titleCase(me.membership.role)} · {me.tenant.name}
            </p>
          </div>

          {canSwitch && (
            <div className="border-b border-[var(--border)] py-1">
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => {
                  setOpen(false);
                  router.push("/select-workspace");
                }}
              >
                <span>Switch workspace</span>
                <ChevronRight className="h-4 w-4 text-[var(--ink3)]" />
              </button>
            </div>
          )}

          <div className="py-1">
            <button
              type="button"
              role="menuitem"
              className={item}
              disabled={logout.isPending}
              onClick={() => {
                setOpen(false);
                logout.mutate();
              }}
            >
              <span>{logout.isPending ? "Signing out…" : "Log out"}</span>
              <LogOut className="h-4 w-4 text-[var(--ink3)]" />
            </button>

            {/*
              `logoutAll` existed and nothing exposed it. For a product where
              a session is the key to a customer's mail, "I signed in on a
              shared machine" needs an answer that does not involve support.
              Confirmed first: it ends this session too.
            */}
            <button
              type="button"
              role="menuitem"
              className={item}
              disabled={logoutAll.isPending}
              onClick={() => {
                setOpen(false);
                setConfirmingEverywhere(true);
              }}
            >
              <span>{logoutAll.isPending ? "Signing out…" : "Sign out everywhere"}</span>
              <MonitorSmartphone className="h-4 w-4 text-[var(--ink3)]" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
