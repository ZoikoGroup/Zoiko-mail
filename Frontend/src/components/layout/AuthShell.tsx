'use client';

import type { ReactNode } from 'react';
import { BrandPanel } from './BrandPanel';
import { ThemeToggle } from './ThemeToggle';

/**
 * The split-panel authentication layout.
 *
 * 44/56 on desktop. Below the lg breakpoint the brand panel becomes a compact
 * header so the card is never squeezed, and below sm the card fills the
 * viewport with 44px touch targets.
 *
 * Deliberately contains no review chrome. An earlier revision docked a list of
 * every authentication state here, which implied the user could choose their
 * own account state — they cannot. The platform resolves it from account
 * status, membership status, tenant status and risk signals, then routes. Each
 * state remains reachable by URL for QA; none is advertised in the product.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-ground">
      <a
        href="#auth-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-field focus:bg-surface focus:px-4 focus:py-2 focus:text-base2 focus:shadow-e2"
      >
        Skip to sign-in form
      </a>

      <div className="grid flex-1 lg:grid-cols-[44%_56%]">
        <BrandPanel />

        <main
          id="auth-main"
          className="relative flex flex-col justify-center bg-surface px-6 py-10 sm:px-8 lg:px-10 lg:py-12"
        >
          <div className="absolute right-4 top-4">
            <ThemeToggle />
          </div>

          {children}
        </main>
      </div>
    </div>
  );
}
