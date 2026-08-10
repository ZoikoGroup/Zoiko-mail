'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { AuthCard, AuthHero } from '@/components/layout/AuthCard';
import { Banner } from '@/components/common/Banner';
import { Button } from '@/components/ui/Button';
import { Note } from '@/components/ui/Card';
import { ROUTES } from '@/constants/routes';

/**
 * Route-level error boundary.
 *
 * Deliberately vague about the cause. A credential surface should not leak
 * stack traces, route names or backend detail to an unauthenticated caller —
 * the request ID is what support needs, and that is all this exposes.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();

  useEffect(() => {
    // In production this is where the error is reported with its digest.
    // eslint-disable-next-line no-console
    console.error('[auth] unhandled error', error.digest ?? error.message);
  }, [error]);

  return (
    <AuthCard>
      <AuthHero
        tone="crit"
        icon={<AlertTriangle aria-hidden className="h-[22px] w-[22px]" strokeWidth={1.7} />}
        title="Something went wrong"
      >
        We couldn&rsquo;t complete that step. Your account has not been changed.
      </AuthHero>

      <Banner tone="info">
        If this keeps happening, quote reference{' '}
        <span className="font-mono">{error.digest ?? 'unavailable'}</span> to your administrator.
      </Banner>

      <div className="flex gap-2.5">
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <Button onClick={() => router.push(ROUTES.signIn)}>Back to sign in</Button>
      </div>

      <Note>No diagnostic detail is exposed on an unauthenticated surface.</Note>
    </AuthCard>
  );
}
