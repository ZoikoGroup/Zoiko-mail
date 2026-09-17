"use client";

import type { ReactNode } from "react";

import { useCan, useCapabilities, type Capability } from "@/lib/admin-capabilities";
import { InlineError, LoadingRows } from "./States";
import { Card } from "./Card";
import { Notice } from "./Notice";

/**
 * Gate a whole screen on a capability.
 *
 * The rail already hides a link the caller lacks the capability for, but
 * hiding a link is not access control — the URL can be typed, and a bookmark
 * survives a demotion. The route re-checks server-side, which is what actually
 * refuses; this exists so the answer is a sentence rather than a screen of
 * failed reads.
 *
 * Deliberately not applied to the "My work" routes. `mail.own.rw` and
 * `commitments.own.manage` are held by every member, so gating an admin's own
 * inbox on them would add a way to be locked out of your own mailbox — a
 * failed capability read — in exchange for no protection at all.
 */
export function RequireCapability({
  capability,
  children,
}: {
  capability: Capability;
  children: ReactNode;
}) {
  const { isLoading, error } = useCapabilities();
  const can = useCan();

  // A capability set that failed to load is not the same as one that came back
  // without this capability. Refusing on a failed read would lock an admin out
  // of a screen they hold, and blame them for it.
  if (isLoading) {
    return (
      <Card>
        <LoadingRows rows={4} />
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <InlineError message={`Could not read your permissions. ${error.message}`} />
      </Card>
    );
  }

  if (!can(capability)) {
    return (
      <Notice tone="warn">
        <b className="text-[var(--warn)]">You do not have access to this screen.</b> It needs{" "}
        <code>{capability}</code>, which your role does not hold. The API refuses these
        reads as well, so this is what you would see either way.
      </Notice>
    );
  }

  return <>{children}</>;
}
