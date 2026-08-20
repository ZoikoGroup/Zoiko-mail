"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isLoggedIn } from "@/lib/auth-storage";
import { useMe } from "@/lib/auth-hooks";
import type { MeResponse } from "@/lib/auth-api";

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
      return;
    }
    if (!isLoading && me && !allowedRoles.includes(me.membership.role)) {
      router.replace("/");
    }
  }, [router, isLoading, me, allowedRoles]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      </div>
    );
  }

  if (me && !allowedRoles.includes(me.membership.role)) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-center">
        <p className="text-sm font-medium text-[var(--ink)]">Access Denied</p>
        <p className="mt-1 text-sm text-[var(--ink3)]">
          You do not have permission to access this page.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
