"use client";

type BadgeVariant = "ok" | "warn" | "crit" | "nu" | "accent" | "ai";

interface StatusBadgeProps {
  variant: BadgeVariant;
  children: React.ReactNode;
  dot?: boolean;
}

export function StatusBadge({ variant, children, dot }: StatusBadgeProps) {
  return (
    <span className={`zoiko-pill ${variant}`}>
      {dot && (
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            variant === "ok"
              ? "bg-[var(--ok)]"
              : variant === "warn"
              ? "bg-[var(--warn)]"
              : variant === "crit"
              ? "bg-[var(--crit)]"
              : variant === "ai"
              ? "bg-[var(--ai)]"
              : variant === "accent"
              ? "bg-[var(--accent)]"
              : "bg-[var(--ink3)]"
          }`}
        />
      )}
      {children}
    </span>
  );
}

export function roleBadge(role: string): BadgeVariant {
  switch (role) {
    case "OWNER": return "accent";
    case "ADMIN": return "ai";
    case "MEMBER": return "nu";
    default: return "nu";
  }
}

export function statusBadge(status: string): BadgeVariant {
  switch (status) {
    case "ACTIVE":
    case "VERIFIED":
    case "CONNECTED":
    case "HEALTHY":
    case "COMPLETED":
      return "ok";
    case "PENDING":
    case "INVITED":
    case "SYNCING":
    case "IN_PROGRESS":
      return "warn";
    case "SUSPENDED":
    case "FAILED":
    case "ERROR":
    case "BLOCKED":
      return "crit";
    default:
      return "nu";
  }
}
