"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isLoggedIn } from "@/lib/auth-storage";

/**
 * The support console is a single dashboard at /support for every support
 * actor — session-scoped SUPPORT members and platform staff alike. This
 * tenant-scoped page is a legacy surface; anything that still points here is
 * sent on to the full console (or the sign-in page when signed out).
 */
export default function TenantSupportRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(isLoggedIn() ? "/support" : "/login");
  }, [router]);

  return null;
}