"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { X, Mail, Sparkles, FileText, Bell, CheckCircle2 } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ToastType = "mail" | "ai" | "draft" | "notification" | "info" | "success";

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  body?: string;
  duration?: number; // ms, default 4000
}

// ── Single Toast ──────────────────────────────────────────────────────────────

type Placement = "bottom-right" | "top-right";

function Toast({ item, onDismiss, placement = "bottom-right" }: {
  item: ToastItem;
  onDismiss: (id: string) => void;
  placement?: Placement;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Animate in
    const show = setTimeout(() => setVisible(true), 10);
    // Auto-dismiss
    let leave: ReturnType<typeof setTimeout> | undefined;
    const hide = setTimeout(() => {
      setVisible(false);
      leave = setTimeout(() => onDismiss(item.id), 300);
    }, item.duration ?? 4000);
    return () => { clearTimeout(show); clearTimeout(hide); clearTimeout(leave); };
  }, [item.id, item.duration, onDismiss]);

  // Slides in from the edge it sits on: sideways at the bottom, down from the
  // header at the top.
  const hidden = placement === "top-right" ? "-translate-y-2 opacity-0" : "translate-x-4 opacity-0";
  const shown = placement === "top-right" ? "translate-y-0 opacity-100" : "translate-x-0 opacity-100";

  const icons: Record<ToastType, React.ReactNode> = {
    mail: <Mail className="h-4 w-4 text-[var(--accent)]" />,
    ai: <Sparkles className="h-4 w-4 text-purple-400" />,
    draft: <FileText className="h-4 w-4 text-green-400" />,
    notification: <Bell className="h-4 w-4 text-yellow-400" />,
    info: <Bell className="h-4 w-4 text-[var(--ink3)]" />,
    success: (
      <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--ok-soft)]">
        <CheckCircle2 className="h-4 w-4 text-[var(--ok)]" aria-hidden="true" />
      </span>
    ),
  };
  const success = item.type === "success";

  return (
    <div
      role="status"
      data-testid={`toast-${item.type}`}
      className={`pointer-events-auto flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--sh3)] transition-all duration-300 ease-out ${
        success ? "items-center border-l-[3px] border-l-[var(--ok)]" : ""
      } ${visible ? shown : hidden}`}
    >
      <div className={success ? "shrink-0" : "mt-0.5 shrink-0"}>{icons[item.type]}</div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[var(--ink)]">{item.title}</div>
        {item.body && (
          <div className="mt-0.5 truncate text-xs text-[var(--ink3)]">{item.body}</div>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => { setVisible(false); setTimeout(() => onDismiss(item.id), 300); }}
        className="shrink-0 rounded p-0.5 text-[var(--ink3)] hover:bg-[var(--s2)]"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Container ─────────────────────────────────────────────────────────────────

export function ToastContainer({ toasts, onDismiss, placement = "bottom-right", top }: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  placement?: Placement;
  /** For "top-right": the distance from the top of the window, in px. */
  top?: number;
}) {
  if (toasts.length === 0) return null;
  return (
    // pointer-events-none on the stack: only the toasts themselves take
    // clicks, so the gap around them never blocks the page underneath.
    <div
      aria-live="polite"
      data-testid={placement === "top-right" ? "toaster" : undefined}
      style={placement === "top-right" ? { top } : undefined}
      className={`pointer-events-none fixed right-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 ${
        placement === "top-right" ? "" : "bottom-4"
      }`}
    >
      {toasts.map((t) => (
        <Toast key={t.id} item={t} onDismiss={onDismiss} placement={placement} />
      ))}
    </div>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const add = (toast: Omit<ToastItem, "id">) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
  };

  const dismiss = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return { toasts, add, dismiss };
}

// ── App-wide toasts ───────────────────────────────────────────────────────────
//
// For messages that belong to no one screen and must outlive a page change,
// such as "Login successful", which is raised on the sign-in page and read in
// the workspace it leads to. One <Toaster /> in the root layout shows them in
// every workspace, so they survive client-side navigation.

let globalToasts: ToastItem[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const EMPTY: ToastItem[] = [];

function dismissGlobal(id: string) {
  globalToasts = globalToasts.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  /**
   * Shows an app-wide toast. Give it a stable `id` to make it one of a kind:
   * while a toast with that id is on screen, another is ignored, so an event
   * reported twice never stacks two copies.
   */
  show(item: Omit<ToastItem, "id"> & { id?: string }) {
    const id = item.id ?? `toast-${Date.now()}-${Math.random()}`;
    if (globalToasts.some((t) => t.id === id)) return;
    globalToasts = [...globalToasts, { ...item, id }];
    emit();
  },
  dismiss: dismissGlobal,
};

/** The gap between the workspace's header and the toasts, and the top margin when there is no header. */
const HEADER_GAP = 12;
const NO_HEADER_TOP = 16;
/** The workspace must be on screen, with no loading screen over it, this long before toasts show. */
const SETTLE_MS = 150;

/** Just below the global header of the workspace on screen (marked data-app-header), so a toast never covers it. */
function belowHeader(): number {
  const header = Array.from(document.querySelectorAll("[data-app-header]"))
    .map((el) => el.getBoundingClientRect())
    .find((rect) => rect.height > 0 && rect.bottom > 0);
  return header ? Math.round(header.bottom) + HEADER_GAP : NO_HEADER_TOP;
}

/**
 * Renders the app-wide toasts, top-right, just below the workspace's global
 * header. Mounted once, in the root layout.
 *
 * A toast raised while the full-screen loading screen is up (a sign-in's,
 * raised as the workspace starts opening) waits for it to leave: it is shown,
 * and its time starts, once the workspace is in view and its header can be
 * measured, so its whole time on screen is spent where it can be read.
 */
export function Toaster() {
  const items = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => globalToasts,
    () => EMPTY
  );
  const [top, setTop] = useState<number | null>(null);
  const pending = items.length > 0;

  useEffect(() => {
    if (!pending) {
      setTop(null);
      return;
    }
    let clearSince: number | null = null;
    const check = window.setInterval(() => {
      if (document.querySelector(".nav-loader")) {
        clearSince = null;
        return;
      }
      clearSince ??= performance.now();
      if (performance.now() - clearSince < SETTLE_MS) return;
      window.clearInterval(check);
      setTop(belowHeader());
    }, 50);
    const onResize = () => setTop((current) => (current === null ? null : belowHeader()));
    window.addEventListener("resize", onResize);
    return () => {
      window.clearInterval(check);
      window.removeEventListener("resize", onResize);
    };
  }, [pending]);

  if (top === null) return null;
  return <ToastContainer toasts={items} onDismiss={dismissGlobal} placement="top-right" top={top} />;
}
