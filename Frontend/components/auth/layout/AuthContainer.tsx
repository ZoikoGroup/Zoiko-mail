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
      <div className="rounded-3xl border border-slate-200 bg-white p-2 shadow-xl transition-all duration-300 sm:p-3 lg:p-4 dark:border-slate-800 dark:bg-slate-900 max-h-[95vh] overflow-y-auto">
        {children}
      </div>
    </div>
  );
}