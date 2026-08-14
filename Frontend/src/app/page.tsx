import { redirect } from 'next/navigation';
import { ROUTES } from '@/constants/routes';

/** The application entry point is the sign-in state. */
export default function RootPage() {
  redirect(ROUTES.signIn);
}
