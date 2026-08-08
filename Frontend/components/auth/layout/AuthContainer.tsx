"use client";

import { ReactNode } from "react";

interface AuthContainerProps {
  children: ReactNode;
}

export default function AuthContainer({
  children,
}: AuthContainerProps) {
  return (
    <div className="w-full max-w-[520px]">
      {/* Card */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xl transition-all duration-300 sm:p-8 lg:p-10 dark:border-slate-800 dark:bg-slate-900">
        {children}
      </div>
    </div>
  );
}