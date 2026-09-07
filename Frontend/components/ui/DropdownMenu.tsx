"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

interface DropdownMenuProps {
  trigger?: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
}

/**
 * Action menu used inside table rows that live in overflow-clipping containers
 * (DataTable wraps cells in overflow-hidden / overflow-x-auto). Rendering the
 * popover absolutely inside the cell would get cut off, so it is portaled to
 * document.body with fixed (viewport) positioning. It also flips upward near
 * the bottom of the viewport so rows in the last visible fields never lose
 * their Change Role / Remove entries off-screen.
 */
export function DropdownMenu({ trigger, children, align = "right" }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number; right: number } | null>(null);

  const updateAnchor = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setAnchor({ top: rect.bottom + 4, left: rect.left, right: window.innerWidth - rect.right });
  }, []);

  const toggle = () => {
    if (!open) updateAnchor();
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = () => updateAnchor();
    const onResize = () => updateAnchor();
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, updateAnchor]);

  // Flip above the trigger when the menu would otherwise extend past the
  // bottom edge of the viewport (rows near the end of the table).
  useLayoutEffect(() => {
    if (!open || !menuRef.current || !anchor) return;
    const rect = menuRef.current.getBoundingClientRect();
    if (rect.bottom > window.innerHeight) {
      const triggerHeight = triggerRef.current?.offsetHeight ?? 0;
      const nextTop = Math.max(8, anchor.top - rect.height - triggerHeight - 8);
      if (nextTop !== anchor.top) setAnchor({ ...anchor, top: nextTop });
    }
  }, [open, anchor]);

  const menuStyle: CSSProperties | undefined = anchor
    ? {
        top: anchor.top,
        ...(align === "right" ? { right: anchor.right } : { left: anchor.left }),
      }
    : undefined;

  return (
    <>
      <div className="relative inline-block">
        <button
          ref={triggerRef}
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ink3)] hover:bg-[var(--s2)] hover:text-[var(--ink2)]"
        >
          {trigger ?? <MoreHorizontal className="h-4 w-4" />}
        </button>
      </div>
      {open &&
        menuStyle &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={menuStyle}
            className="fixed z-50 min-w-[160px] rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[var(--sh2)]"
            onClick={() => setOpen(false)}
          >
            {children}
          </div>,
          document.body
        )}
    </>
  );
}

interface DropdownItemProps {
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  children: ReactNode;
}

export function DropdownItem({ onClick, danger, disabled, children }: DropdownItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition ${
        danger
          ? "text-[var(--crit)] hover:bg-[var(--crit-soft)]"
          : "text-[var(--ink2)] hover:bg-[var(--s2)]"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      {children}
    </button>
  );
}