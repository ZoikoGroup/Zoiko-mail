"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isLoggedIn } from "@/lib/auth-storage";
import { useMe } from "@/lib/auth-hooks";
import type { MeResponse } from "@/lib/auth-api";
import { AccessDenied } from "@/components/ui/AccessDenied";

interface ProtectedRouteProps {
  allowedRoles?: string[];
  children: React.ReactNode;
}

export function ProtectedRoute({ allowedRoles = ["OWNER", "ADMIN"], children }: ProtectedRouteProps) {
  const router = useRouter();
  const { data, isLoading } = useMe();
  const me = data as MeResponse | undefined;

  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/login");
    }
  }, [router]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      </div>
    );
  }

  // Not logged in (or /auth/me failed) — the effect above sends to login.
  if (!me) return null;

  // Authenticated but not permitted: show a clear warning instead of
  // silently redirecting or rendering restricted content.
  if (!allowedRoles.includes(me.membership.role)) {
    return <AccessDenied role={me.membership.role} />;
  }

  return <>{children}</>;
}
