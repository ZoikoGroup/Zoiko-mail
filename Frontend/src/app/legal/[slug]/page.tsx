import { notFound } from 'next/navigation';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { AuthCard, AuthHero } from '@/components/layout/AuthCard';
import { Note, Panel } from '@/components/ui/Card';
import { ROUTES } from '@/constants/routes';

/**
 * Legal pages reached from the footer on every authentication state.
 *
 * They exist because Tenant.primary_region includes uk and eu and a
 * credential surface in those regions needs Terms, Privacy and a cookie
 * notice reachable without signing in. The wording itself is owned by Legal —
 * these routes are the placeholders that make the links real rather than
 * decorative, and each says so plainly rather than pretending to be final.
 */

const PAGES = {
  terms: {
    title: 'Terms of service',
    summary: 'The agreement between your organisation and Zoiko Tech Inc for use of Zoiko Mail.',
    points: [
      'Acceptable use during the controlled pilot, including the prohibition on bulk and cold outbound sending.',
      'Service scope: connector intelligence and, where enabled, hosted mailboxes on a provider-backed infrastructure.',
      'Pilot limitations — no enterprise compliance claim is made while DLP, legal hold and eDiscovery remain unbuilt.',
    ],
  },
  privacy: {
    title: 'Privacy notice',
    summary: 'What Zoiko Mail stores, why, for how long, and the rights your organisation holds over it.',
    points: [
      'Data classes D0–D6, with message bodies stored only where hosted mail or an enabled feature requires it.',
      'Attachment contents are never indexed. AI training on customer data is disabled by default.',
      'Deletion completes within 30 calendar days of a verified request; exports expire after 7 days.',
    ],
  },
  cookies: {
    title: 'Cookie notice',
    summary: 'Zoiko Mail sets the minimum needed to keep you signed in and to remember your theme.',
    points: [
      'Session cookie — required. Carries no personal data beyond the session identifier.',
      'CSRF token — required. Protects state-changing requests on cookie-based authentication.',
      'Theme preference — stored locally, not transmitted, and cleared when you choose "system".',
    ],
  },
} as const;

type Slug = keyof typeof PAGES;

export function generateStaticParams() {
  return (Object.keys(PAGES) as Slug[]).map((slug) => ({ slug }));
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = PAGES[slug as Slug];
  if (!page) notFound();

  return (
    <AuthCard wide footer={false}>
      <AuthHero
        tone="muted"
        icon={<FileText aria-hidden className="h-[22px] w-[22px]" strokeWidth={1.7} />}
        title={page.title}
      >
        {page.summary}
      </AuthHero>

      <Panel label="What this document covers">
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {page.points.map((point) => (
            <li key={point} className="flex gap-2 text-xs2 leading-[1.6]">
              <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-3" />
              {point}
            </li>
          ))}
        </ul>
      </Panel>

      <Note>
        Final wording is owned by Legal. This route exists so the footer links resolve rather than dead-end — the
        specifications require the notice to be reachable, not that engineering author it.
      </Note>

      <Link href={ROUTES.signIn} className="text-xs2 font-semibold text-accent no-underline hover:underline">
        &larr; Back to sign in
      </Link>
    </AuthCard>
  );
}
