import { CredentialForm } from '../components/CredentialForm';

export const metadata = { title: 'Sign in · Zoiko Mail' };

/**
 * A rejected attempt returns to the same sign-in surface with a generic
 * failure banner — not a separate "login failed" page. A distinct screen would
 * itself be a signal, and the whole point of the generic message is to give an
 * attacker nothing.
 *
 * Wrong password, unknown email and AppUser.status = deleted all land here with
 * identical copy. Audit §6.1 records failed_login either way, and the fifth
 * consecutive failure resolves to the lock outcome instead of this one.
 */
export default function SignInFailedPage() {
  return <CredentialForm retry />;
}
