import Link from 'next/link';
import { LEGAL_ENTITY, LEGAL_LINKS } from '@/constants/legal';

/**
 * Present on every authentication state.
 *
 * Closes a gap the specifications do not cover: Tenant.primary_region
 * includes uk and eu, and Audit §5 references DPA-ready terms and a privacy
 * notice, but no clause requires the login page to surface them. A UK/EU
 * credential page needs them, so they ship here.
 */
export function LegalFooter() {
  return (
    <footer className="mt-5 flex flex-wrap items-center gap-[13px] border-t border-border pt-[15px]">
      {LEGAL_LINKS.map(({ label, href }) => (
        <Link
          key={label}
          href={href}
          className="text-[11.5px] text-ink-3 no-underline transition-colors hover:text-ink-2 hover:underline"
        >
          {label}
        </Link>
      ))}
      <span className="ml-auto text-[11px] text-ink-3">{LEGAL_ENTITY}</span>
    </footer>
  );
}
