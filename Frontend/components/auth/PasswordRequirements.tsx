"use client";

import { usePasswordPolicy } from "@/lib/auth-hooks";
import { Check, X } from "lucide-react";

/**
 * Renders the password rules straight from the server's /auth/password-policy
 * endpoint, so the form never drifts from what the backend enforces. Each rule
 * lights up green as the candidate satisfies it.
 */
export default function PasswordRequirements({
  password,
  className = "",
}: {
  password: string;
  className?: string;
}) {
  const { data: policy } = usePasswordPolicy();
  if (!policy) return null;

  const classCount = policy.classes.filter(({ test }) =>
    new RegExp(`[${test}]`).test(password)
  ).length;

  const rules: Array<{ id: string; label: string; ok: boolean }> = [
    {
      id: "length",
      label: `At least ${policy.minLength} characters`,
      ok: password.length >= policy.minLength,
    },
    {
      id: "classes",
      label: `Mix of ${policy.minClasses}+ character types`,
      ok: classCount >= policy.minClasses,
    },
    {
      id: "repeats",
      label: "No repeated characters in a row",
      ok: !new RegExp(`(.)\\1{2,}`).test(password),
    },
  ];

  return (
    <ul className={`space-y-1 ${className}`}>
      {rules.map((rule) => (
        <li
          key={rule.id}
          className="flex items-center gap-1.5 text-xs text-[var(--ink3)]"
        >
          {rule.ok ? (
            <Check className="h-3 w-3 text-teal-600" />
          ) : (
            <X className="h-3 w-3 text-[var(--ink4)]" />
          )}
          {rule.label}
        </li>
      ))}
    </ul>
  );
}