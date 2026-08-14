import type { Metadata, Viewport } from 'next';
import { AuthShell } from '@/components/layout/AuthShell';
import { Providers } from '@/components/layout/Providers';
import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/theme';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'Sign in · Zoiko Mail',
  description: 'Secure business email that turns communication into accountable work.',
  applicationName: 'Zoiko Mail',
  // A credential surface should never be indexed.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eef2f6' },
    { media: '(prefers-color-scheme: dark)', color: '#040809' },
  ],
};

/**
 * Every route in this project is an authentication state, so the split shell
 * lives in the root layout and pages supply only their card content.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint so a dark-mode user never sees a flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>
        <Providers>
          <AuthShell>{children}</AuthShell>
        </Providers>
      </body>
    </html>
  );
}
