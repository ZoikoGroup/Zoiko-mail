"use client";

import { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

export default function AuthCard({
  children,
}: Props) {
  return (
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl dark:border-slate-800 dark:bg-slate-950">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-teal-600 text-xl font-bold text-white">
          Z
        </div>

        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Zoiko Mail
        </h1>

        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Securely access your workspace
        </p>
      </div>

      {children}
    </div>
  );
}