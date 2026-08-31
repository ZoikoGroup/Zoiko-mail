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

  // This page is the GLOBAL platform console — staff only. A tenant-scoped
  // SUPPORT member (invited by a workspace Owner for read-only diagnostics)
  // must be routed to their tenant workspace instead; the backend also
  // rejects their token on /support/platform. If we don't hold a staff
  // platform token and aren't authenticated staff, bounce to login.
  useEffect(() => {
    if (me && me.membership?.role === "SUPPORT") {
      router.replace("/tenant-support");
      return;
    }
    if (!getPlatformToken() && !isLoading && !me) {
      router.replace("/login");
    }
  }, [me, isLoading, router]);

  return <PlatformConsole />;
}
