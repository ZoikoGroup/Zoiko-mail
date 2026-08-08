"use client";

import { InputHTMLAttributes } from "react";
import { IconType } from "react-icons";

interface FormInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  icon?: IconType;
  error?: string;
}

export default function FormInput({
  label,
  icon: Icon,
  error,
  className = "",
  ...props
}: FormInputProps) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>

      <div
        className={`flex items-center rounded-lg border bg-white  transition-all duration-200
        ${
          error
            ? "border-red-500 focus-within:ring-2 focus-within:ring-red-500"
            : "border-slate-300 focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500"
        }
        dark:border-slate-700 dark:bg-slate-900`}
      >
        {Icon && (
          <Icon className="ml-3 shrink-0 text-slate-400 dark:text-slate-500" />
        )}

        <input
          {...props}
          className={`w-full bg-transparent dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-white ${className}`}
        />
      </div>

      {error && (
        <p className="text-sm text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}