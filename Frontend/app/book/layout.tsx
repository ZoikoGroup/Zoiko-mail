import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Book a time | Zoiko Mail",
  // Booking pages are shared by link, not found by search.
  robots: { index: false, follow: false },
};

export default function BookLayout({ children }: { children: React.ReactNode }) {
  return children;
}
