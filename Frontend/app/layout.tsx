import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { NavigationLoader } from "@/components/shell/NavigationLoader";

export const metadata: Metadata = {
  title: {
    default: "Zoiko Mail",
    template: "%s | Zoiko Mail",
  },
  description: "Business email that turns communication into accountable work.",
};

// Runs before paint to apply the saved (or system) theme with no flash of
// the wrong color scheme. Kept tiny and inlined on purpose.
const themeScript = `
try {
  var t = localStorage.getItem('theme');
  var dark = t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (dark) document.documentElement.classList.add('dark');
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>
          {children}
          <NavigationLoader />
        </Providers>
      </body>
    </html>
  );
}