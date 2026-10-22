"use client";

import { CSSProperties, ReactNode } from "react";
import AuthShowcase from "./AuthShowcase";

interface AuthLayoutProps {
  children: ReactNode;
}

/**
 * The auth screens use the brand blue while the rest of the app stays teal.
 * Shared inputs read their focus colour from this variable (teal when unset),
 * so the account page's change-password form is unaffected.
 */
const AUTH_THEME = { "--auth-focus": "#2563eb" } as CSSProperties;

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <main
      style={AUTH_THEME}
      className="min-h-screen bg-slate-50 transition-colors duration-300 dark:bg-slate-950"
    >
      {/* minmax(0, …) so the showcase's one-line nav and footer can't widen
          their column past its share and slide under the form side. */}
      <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        {/* LEFT SHOWCASE */}

        <AuthShowcase />

        {/* RIGHT FORM AREA */}

        <section className="flex h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-blue-50 via-slate-50 to-sky-100/70 px-6 py-8 sm:px-8 lg:px-10 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
          {children}
        </section>
      </div>
    </main>
  );
}
