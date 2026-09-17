"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import PlatformConsole from "@/components/support/PlatformConsole";
import { useMe } from "@/lib/auth-hooks";
import { getPlatformToken } from "@/lib/auth-storage";

export default function PlatformConsolePage() {
  const router = useRouter();
  const { data, isLoading } = useMe();
  const me = data as { membership?: { role?: string } } | undefined;

  useEffect(() => { document.title = "Support | Zoiko Mail"; }, []);

  // The support console is the single support dashboard: session-scoped SUPPORT
  // members (invited by a workspace Owner) and platform staff both land here.
  // If we don't hold a staff platform token and aren't authenticated, bounce to
  // the staff sign-in page.
  useEffect(() => {
    if (!getPlatformToken() && !isLoading && !me) {
      router.replace("/staff/login");
    }
  }, [me, isLoading, router]);

  return <PlatformConsole />;
}
