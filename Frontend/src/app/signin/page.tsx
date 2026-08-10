import { CredentialForm } from './components/CredentialForm';

export const metadata = { title: 'Sign in · Zoiko Mail' };

/**
 * The sign-in page. Email, password, Proceed — nothing else.
 *
 * Every other authentication screen is an outcome the platform routes to based
 * on the credentials given and what it knows about the account. The resolution
 * order lives in constants/scenarios.ts and mirrors Security §7.2.
 */
export default function SignInPage() {
  return <CredentialForm />;
}
