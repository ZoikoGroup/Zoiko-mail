"use client";

import { PASSWORD_POLICY } from "@/lib/password-policy";
import { Check, X } from "lucide-react";

/**
 * Renders the password rules the backend enforces, mirrored locally (see
 * lib/password-policy.ts). Each rule lights up green as the candidate
 * satisfies it.
 */
export default function PasswordRequirements({
  password,
  className = "",
}: {
  password: string;
  className?: string;
}) {
  const classCount = PASSWORD_POLICY.classes.filter(({ test }) =>
    new RegExp(`[${test}]`).test(password)
  ).length;

  const rules: Array<{ id: string; label: string; ok: boolean }> = [
    {
      id: "length",
      label: `At least ${PASSWORD_POLICY.minLength} characters`,
      ok: password.length >= PASSWORD_POLICY.minLength,
    },
    {
      id: "classes",
      label: `Mix of ${PASSWORD_POLICY.minClasses}+ character types`,
      ok: classCount >= PASSWORD_POLICY.minClasses,
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
            <X className="h-3 w-3 text-[var(--ink3)]" />
          )}
          {rule.label}
        </li>
      ))}
    </ul>
  );
}