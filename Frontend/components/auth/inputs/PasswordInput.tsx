"use client";

import { useState, InputHTMLAttributes } from "react";
import { FaEye, FaEyeSlash, FaLock } from "react-icons/fa";

interface PasswordInputProps
  extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export default function PasswordInput({
  label,
  error,
  className = "",
  ...props
}: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>

      <div
        // Focus colour comes from AuthLayout's --auth-focus; teal elsewhere.
        className={`flex items-center overflow-hidden rounded-xl border bg-white transition-all duration-200
        ${
          error
            ? "border-red-500 focus-within:ring-2 focus-within:ring-red-500"
            : "border-slate-200 focus-within:border-[color:var(--auth-focus,#14b8a6)] focus-within:ring-1 focus-within:ring-[color:var(--auth-focus,#14b8a6)]"
        }
        dark:border-slate-700 dark:bg-slate-900`}
      >
        <FaLock className="ml-4 shrink-0 text-slate-500 dark:text-slate-500" />

        <input
          {...props}
          type={showPassword ? "text" : "password"}
          className={`min-w-0 flex-1 bg-transparent px-3 py-3 focus-visible:outline-none autofill:shadow-[inset_0_0_0_1000px_#fff] dark:autofill:shadow-[inset_0_0_0_1000px_#0f172a] dark:autofill:[-webkit-text-fill-color:#fff] text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-white ${className}`}
        />

        <button
          type="button"
          onClick={() => setShowPassword((prev) => !prev)}
          aria-label={showPassword ? "Hide password" : "Show password"}
          className="mr-4 text-slate-500 transition hover:text-[color:var(--auth-focus,#0d9488)]"
        >
          {showPassword ? <FaEyeSlash /> : <FaEye />}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}