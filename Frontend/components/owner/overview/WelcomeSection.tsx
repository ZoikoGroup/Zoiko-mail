"use client";

import { useMe } from "@/lib/auth-hooks";
import type { MeResponse } from "@/lib/auth-api";

export function WelcomeSection() {
  const { data } = useMe();
  const me = data as MeResponse | undefined;

  return (
    <div>
      <h1 className="font-editorial text-2xl font-semibold tracking-tight text-[var(--ink)] sm:text-3xl">
        {me ? `Welcome back, ${me.displayName.split(" ")[0]}` : "Owner Dashboard"}
      </h1>
      <p className="mt-1 text-sm text-[var(--ink3)]">
        {me ? (
          <>
            Managing{" "}
            <span className="font-medium text-[var(--ink2)]">{me.tenant.name}</span> as{" "}
            <span className="zoiko-pill accent">{me.membership.role}</span>
          </>
        ) : (
          "Loading your organization…"
        )}
      </p>
    </div>
  );
}
