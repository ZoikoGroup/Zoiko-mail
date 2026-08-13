'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Eye, EyeOff } from 'lucide-react';
import { AuthCard, AuthHeading } from '@/components/layout/AuthCard';
import { Banner } from '@/components/common/Banner';
import { TextField } from '@/components/forms/TextField';
import { Button } from '@/components/ui/Button';
import { Divider, Note } from '@/components/ui/Card';
import { ROUTES } from '@/constants/routes';
import { useSignInFlow } from '@/hooks/useSignInFlow';
import { useAuthStore } from '@/store/auth-store';
import { trackFunnel } from '@/services/telemetry';

/**
 * The only external surface: email, password, Proceed.
 *
 * No state list, no navigator, no hint of the fourteen other screens. What
 * happens after Proceed is resolved by the platform from account status,
 * membership status, tenant status and risk signals — the user never chooses.
 *
 * `retry` shows the generic failure banner when the caller has been sent back
 * here after a rejected attempt.
 */
export function CredentialForm({ retry = false }: { retry?: boolean }) {
  const email = useAuthStore((s) => s.email);
  const password = useAuthStore((s) => s.password);
  const setEmail = useAuthStore((s) => s.setEmail);
  const setPassword = useAuthStore((s) => s.setPassword);
  const credentialsEntered = useAuthStore((s) => s.credentialsEntered);

  const lastOutcome = useAuthStore((s) => s.lastOutcome);
  const attempts = useAuthStore((s) => s.attempts);
  const attemptsRemaining = useAuthStore((s) => s.attemptsRemaining);

  const { proceed, busy } = useSignInFlow();
  const [reveal, setReveal] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    trackFunnel('signin_viewed');
  }, []);

  // Driven by state, not by the route. A second rejection lands on the page
  // already showing, so a route-only signal would leave the screen unchanged.
  const rejected = retry || lastOutcome === 'failed';
  const remaining = attemptsRemaining();

  // Move focus to the error so a screen-reader user hears the cause without
  // having to hunt for it. Keyed on the attempt count so a repeat rejection
  // re-announces rather than sitting silent.
  useEffect(() => {
    if (rejected) bannerRef.current?.focus();
  }, [rejected, attempts]);

  const ready = credentialsEntered();

  return (
    <AuthCard>
      <AuthHeading title="Sign in">Use the work email your workspace invited.</AuthHeading>

      {rejected && (
        <div ref={bannerRef} tabIndex={-1} className="outline-none">
          <Banner tone="crit" live>
            <b>We couldn&rsquo;t sign you in.</b> Check your email and password and try again.
            {remaining > 0 && remaining < 5 && (
              <>
                {' '}
                {remaining} {remaining === 1 ? 'attempt' : 'attempts'} remaining before this account
                locks.
              </>
            )}
          </Banner>
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void proceed();
        }}
        className="flex flex-col gap-4"
        noValidate
      >
        <TextField
          label="Work email"
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          spellCheck={false}
          autoFocus
          invalid={rejected}
          placeholder="you@company.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <TextField
          label="Password"
          type={reveal ? 'text' : 'password'}
          name="password"
          autoComplete="current-password"
          invalid={rejected}
          placeholder="••••••••••"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          tail={
            <button
              type="button"
              onClick={() => setReveal((v) => !v)}
              aria-label={reveal ? 'Hide password' : 'Show password'}
              title={reveal ? 'Hide password' : 'Show password'}
              className="grid h-5 w-5 place-items-center rounded text-ink-3 transition-colors hover:text-ink-2"
            >
              {reveal ? (
                <EyeOff aria-hidden className="h-3.5 w-3.5" strokeWidth={1.9} />
              ) : (
                <Eye aria-hidden className="h-3.5 w-3.5" strokeWidth={1.9} />
              )}
            </button>
          }
        />

        <Button type="submit" variant="primary" disabled={!ready} loading={busy('proceed')}>
          Proceed
          <ArrowRight aria-hidden className="h-3.5 w-3.5" strokeWidth={1.9} />
        </Button>
      </form>

      <Divider />

      <Link href={ROUTES.recovery} className="self-start text-xs2 font-semibold text-accent no-underline hover:underline">
        Can&rsquo;t sign in?
      </Link>

      <Note>
        Zoiko Mail has no public sign-up. Access is by workspace invitation only during the controlled pilot.
      </Note>
    </AuthCard>
  );
}
