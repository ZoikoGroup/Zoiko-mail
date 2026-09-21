"use client";

import { useState } from "react";
import Image from "next/image";
import { useLogout, useMe } from "@/lib/auth-hooks";
import TicketsPage from "@/components/support/TicketsPage";
import { supportStyles } from "@/components/support/support-styles";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

/**
 * The tenant-scoped support console.
 *
 * This is what a workspace Support member (invited by the Owner with the
 * SUPPORT role) reaches at /support. The invitation is the authorization: an
 * accepted, active SUPPORT membership opens the console without a separate
 * support access grant.
 *
 * Scope is deliberately "Tickets only": the member answers their OWN
 * workspace's support queue. Fleet-wide tools (Tenants, Tokens, provider/
 * delivery events, jobs, suppressions, audit, …) are staff-only and do not
 * exist here, and the tenant-scoped section lists were dropped so the console
 * cannot be mistaken for an investigation surface it is not authorized to be.
 */

function initials(name: string | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return (first + last).toUpperCase();
}

export default function TenantSupportConsole() {
  const logout = useLogout();
  const meQuery = useMe();
  const me = meQuery.data;
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="support-workspace">
      <style jsx global>
        {supportStyles}
      </style>

      {mobileOpen && (
        <div className="drawer">
          <div className="scrim" onClick={() => setMobileOpen(false)} />
          <div className="panel">
            <div className="drawerhead">
              <Image src="/ZoikoMail_Logo_DarkBG_PNG.png" width={400} height={100} className="h-10 w-auto" alt="Zoiko Mail" priority />
              <button className="menubtn" onClick={() => setMobileOpen(false)} aria-label="Close menu">
                ✕
              </button>
            </div>
            <RailMenu onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="shell">
        <nav className="rail">
          <div className="rail-brand">
            <Image src="/ZoikoMail_Logo_DarkBG_PNG.png" width={400} height={100} className="h-10 w-auto" alt="Zoiko Mail" priority />
          </div>
          <RailMenu />
        </nav>

        <div className="body">
          <div className="topbar">
            <button className="menubtn" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              ☰
            </button>
            <div className="brand">
              <span className="bname">Support</span>
              <span className="bsub">{me?.tenant?.name ?? "Workspace"}</span>
            </div>
            <div className="sp" />
            <ThemeToggle />
            <span className="pill accent">Support member</span>
            <div className="who">
              <div className="avatar">{initials(me?.displayName)}</div>
              <div>
                <b>{me?.displayName ?? "Support member"}</b>
                <span>{me?.membership?.role ?? "SUPPORT"} · {me?.tenant?.name ?? ""}</span>
              </div>
              <button className="btn sm" onClick={() => logout.mutate()}>
                Log out
              </button>
            </div>
          </div>

          <main>
            <div className="page">
              <div className="crumbs">
                <span>Support Workspace</span>
                <span>/</span>
                <span className="cur">Tickets</span>
              </div>

              <div className="pagehd">
                <div>
                  <h1>Tickets</h1>
                  <p>Workspace support for {me?.tenant?.name ?? "your workspace"} — fleet-wide tools are staff-only.</p>
                </div>
              </div>

              <TicketsPage mode="tenant" />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function RailMenu({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <button className="railitem on" onClick={() => onNavigate?.()}>
      <span className="ico">✎</span>
      <span>Tickets</span>
    </button>
  );
}