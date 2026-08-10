"use client";

import { ReactNode } from "react";
import AuthShowcase from "./AuthShowcase";

interface AuthLayoutProps {
  children: ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <main className="min-h-screen bg-slate-50 transition-colors duration-300 dark:bg-slate-950">
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
        {/* LEFT SHOWCASE */}

        <AuthShowcase />

        {/* RIGHT FORM AREA */}

        <section className="flex overflow-hidden h-screen items-center justify-center px-6 py-8 sm:px-8 lg:px-10">
          {children}
        </section>
      </div>
    </main>
  );
}