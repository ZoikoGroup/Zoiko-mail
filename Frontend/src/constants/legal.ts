import { ROUTES } from './routes';

/**
 * Present on every authentication state.
 *
 * Closes a gap the specifications do not cover: Tenant.primary_region
 * includes uk and eu, and Audit §5 references DPA-ready terms and a
 * privacy notice, but no clause requires the login page to surface them.
 */
export const LEGAL_LINKS = [
  { label: 'Terms', href: ROUTES.legalTerms },
  { label: 'Privacy', href: ROUTES.legalPrivacy },
  { label: 'Cookies', href: ROUTES.legalCookies },
] as const;

export const LEGAL_ENTITY = '© Zoiko Tech Inc';

/** Cohort and region badges shown on the brand panel. */
export const PILOT_BADGES = ['Controlled pilot · C2', 'UK region', 'Invite only'] as const;

/**
 * The three trust signals. PRD §26 names customer distrust of mailbox
 * access as a High risk with a trust page as the control, and Gate 3
 * requires ≥60% of invited pilot users to complete a connection.
 */
export const TRUST_SIGNALS = [
  {
    icon: 'eye',
    title: 'Read-only by default',
    body: 'Connected inboxes are never sent from, deleted from or modified.',
  },
  {
    icon: 'trace',
    title: 'Every suggestion is evidenced',
    body: 'Each detected commitment links to the exact sentence behind it.',
  },
  {
    icon: 'shield',
    title: 'No training on your data',
    body: 'Attachment contents are never indexed. Support has no standing access.',
  },
] as const;

export const BRAND_THESIS = 'Secure business email that turns communication into accountable work.';
