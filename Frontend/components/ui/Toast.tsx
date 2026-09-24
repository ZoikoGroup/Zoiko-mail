"use client";

import { useEffect, useState } from "react";
import { X, Mail, Sparkles, FileText, Bell } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ToastType = "mail" | "ai" | "draft" | "notification" | "info";

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  body?: string;
  duration?: number; // ms, default 4000
}

// ── Single Toast ──────────────────────────────────────────────────────────────

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Animate in
    const show = setTimeout(() => setVisible(true), 10);
    // Auto-dismiss
    const hide = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(item.id), 300);
    }, item.duration ?? 4000);
    return () => { clearTimeout(show); clearTimeout(hide); };
  }, [item.id, item.duration, onDismiss]);

  const icons: Record<ToastType, React.ReactNode> = {
    mail: <Mail className="h-4 w-4 text-[var(--accent)]" />,
    ai: <Sparkles className="h-4 w-4 text-purple-400" />,
    draft: <FileText className="h-4 w-4 text-green-400" />,
    notification: <Bell className="h-4 w-4 text-yellow-400" />,
    info: <Bell className="h-4 w-4 text-[var(--ink3)]" />,
  };

  return (
    <div
      className={`flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--sh3)] transition-all duration-300 ${
        visible ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0"
      }`}
    >
      <div className="mt-0.5 shrink-0">{icons[item.type]}</div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[var(--ink)]">{item.title}</div>
        {item.body && (
          <div className="mt-0.5 truncate text-xs text-[var(--ink3)]">{item.body}</div>
        )}
      </div>
      <button
        onClick={() => { setVisible(false); setTimeout(() => onDismiss(item.id), 300); }}
        className="shrink-0 rounded p-0.5 text-[var(--ink3)] hover:bg-[var(--s2)]"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Container ─────────────────────────────────────────────────────────────────

export function ToastContainer({ toasts, onDismiss }: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <Toast key={t.id} item={t} onDismiss={onDismiss} />
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