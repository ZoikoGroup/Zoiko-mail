"use client";

import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "./Modal";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: "danger" | "warning";
  loading?: boolean;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  variant = "danger",
  loading,
  children,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button onClick={onClose} className="zoiko-btn" disabled={loading}>
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`zoiko-btn ${variant === "danger" ? "crit" : ""}`}
            disabled={loading}
            style={
              variant === "warning"
                ? { background: "var(--warn-soft)", borderColor: "var(--warn-soft)", color: "var(--warn)" }
                : undefined
            }
          >
            {loading ? "Processing…" : confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex gap-3">
        <span
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            variant === "danger" ? "bg-[var(--crit-soft)] text-[var(--crit)]" : "bg-[var(--warn-soft)] text-[var(--warn)]"
          }`}
        >
          <AlertTriangle className="h-5 w-5" />
        </span>
        <p className="text-sm text-[var(--ink2)]">{message}</p>
      </div>
      {children}
    </Modal>
  );
}
