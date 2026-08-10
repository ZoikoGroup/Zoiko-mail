import Link from 'next/link';
import { Compass } from 'lucide-react';
import { AuthCard, AuthHero } from '@/components/layout/AuthCard';
import { Note } from '@/components/ui/Card';
import { ROUTES } from '@/constants/routes';

/**
 * Unknown route. Deliberately reveals nothing about which paths exist — an
 * unauthenticated probe should not be able to distinguish a real route from
 * a fabricated one.
 */
export default function NotFound() {
  return (
    <AuthCard>
      <AuthHero
        tone="muted"
        icon={<Compass aria-hidden className="h-[22px] w-[22px]" strokeWidth={1.7} />}
        title="That page isn’t here"
      >
        The link may be out of date, or you may need to sign in first.
      </AuthHero>

      <Link
        href={ROUTES.signIn}
        className="inline-flex w-full items-center justify-center gap-2 rounded-field border border-accent bg-accent px-4 py-[11px] text-base2 font-semibold text-accent-on shadow-e1 transition-[filter] hover:brightness-[1.06]"
      >
        Go to sign in
      </Link>

      <Note>Unknown routes reveal nothing about which paths exist.</Note>
    </AuthCard>
  );
}
