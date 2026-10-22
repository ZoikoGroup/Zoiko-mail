"use client";

import { ReactNode } from "react";

interface AuthContainerProps {
  children: ReactNode;
}

export default function AuthContainer({
  children,
}: AuthContainerProps) {
  return (
    <div className="w-full max-w-[540px]">
      {/* Card */}
      <div className="max-h-[95vh] overflow-y-auto rounded-[28px] border border-white bg-white/95 p-4 shadow-[0_24px_60px_-24px_rgba(30,64,175,0.35)] transition-all duration-300 sm:p-6 lg:p-8 dark:border-slate-800 dark:bg-slate-900">
        {children}
      </div>
    </div>
  );
}
