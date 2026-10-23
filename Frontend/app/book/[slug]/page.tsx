"use client";

import { PublicBookingPage } from "@/components/calendar/PublicBookingPage";

/** /book/<slug> — a scheduling link's public booking page. No sign-in. */
export default function BookPage({ params }: { params: { slug: string } }) {
  return <PublicBookingPage slug={params.slug} />;
}
