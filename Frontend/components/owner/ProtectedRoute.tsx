"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isLoggedIn } from "@/lib/auth-storage";
import { useMe } from "@/lib/auth-hooks";
import type { MeResponse } from "@/lib/auth-api";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { BrandLoader } from "@/components/ui/BrandLoader";

interface ProtectedRouteProps {
  allowedRoles?: string[];
  children: React.ReactNode;
}

export function ProtectedRoute({ allowedRoles = ["OWNER", "ADMIN"], children }: ProtectedRouteProps) {
  const router = useRouter();
  // `isPending` (not `isLoading`): during SSR there is no window/localStorage,
  // so the /auth/me query starts disabled and never settles. A disabled query
  // has isLoading === false, which made the server render `null` and the
  // client's first render show the spinner — a hydration mismatch that crashed
  // hydration and let React re-render the whole root, wiping the `.dark` class
  // the no-flash script applied to <html> (the "theme resets to light" bug).
  const { data, isPending, isError } = useMe();
  const me = data as MeResponse | undefined;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!isLoggedIn()) {
      router.replace("/login");
    }
  }, [router]);

  // Identical placeholder on server and client until mounted, so hydration
  // always matches. The token is unreadable before mount anyway.
  if (!mounted || (isPending && !isError)) {
    // Inside the owner console's frame, so the compact variant.
    return <BrandLoader variant="inline" label="Loading" />;
  }

  // Settled without a user (expired/invalid token): the shell's effect
  // redirects to /login when /auth/me fails.
  if (!me) return null;

  // Authenticated but not permitted: show a clear warning instead of
  // silently redirecting or rendering restricted content.
  if (!allowedRoles.includes(me.membership.role)) {
    return <AccessDenied role={me.membership.role} />;
  }

  return <>{children}</>;
}
