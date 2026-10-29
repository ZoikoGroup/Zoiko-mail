"use client";

import { AtSign, BadgeCheck, Ban, CheckCircle2, Plus, ShieldCheck, UserRound, Users } from "lucide-react";
import { useSendableMailboxes } from "@/lib/mail-hooks";
import type { SendableMailbox } from "@/lib/mail-api";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import { SettingsNotice, SoonBadge } from "@/components/settings/SettingsBits";
import type { SettingsSection } from "@/components/settings/sections";
import { BrandLoader } from "@/components/ui/BrandLoader";

/**
 * Settings → Sender Identities: every address you can send from — your own
 * mailbox, and the shared ones your administrator has let you send as. The
 * same list the composer's From menu offers (GET /mail/send-as).
 */

const KIND: Record<SendableMailbox["type"], { label: string; icon: typeof UserRound }> = {
  USER: { label: "Your mailbox", icon: UserRound },
  SHARED: { label: "Shared mailbox", icon: Users },
  DISTRIBUTION: { label: "Distribution list", icon: Users },
  SYSTEM: { label: "System address", icon: AtSign },
  NO_REPLY: { label: "No-reply address", icon: AtSign },
};

export function SenderIdentities({ section }: { section: SettingsSection }) {
  const { data, isLoading, error } = useSendableMailboxes();
  const mailboxes = data?.mailboxes ?? [];
  // Your own mailbox first: it is what a new message is sent from unless you choose otherwise.
  const ordered = [...mailboxes].sort((a, b) => Number(b.type === "USER") - Number(a.type === "USER"));

  return (
    <SettingsWorkspace
      section={section}
      actions={
        <button type="button" className="zoiko-btn" disabled title="Adding your own identities is coming soon">
          <Plus className="h-4 w-4" aria-hidden /> Add identity <SoonBadge />
        </button>
      }
    >
      <SettingsNotice lead="Who your mail comes from." icon={ShieldCheck}>
        Choose any of these in the From menu when you write a message. Shared addresses appear when your administrator gives you permission to send from them.
      </SettingsNotice>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section aria-label="Sending addresses" className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
            <h2 className="text-[15px] font-semibold text-[var(--ink)]">Sending addresses</h2>
            {!isLoading && !error && (
              <span className="text-[11.5px] text-[var(--ink3)]">
                {mailboxes.length} address{mailboxes.length === 1 ? "" : "es"}
              </span>
            )}
          </div>

          {isLoading ? (
            <BrandLoader variant="compact" label="Loading your addresses" />
          ) : error ? (
            <p role="alert" className="px-5 py-8 text-[12.5px] text-[var(--crit)]">Could not load your addresses ({(error as Error).message}).</p>
          ) : mailboxes.length === 0 ? (
            <p className="px-5 py-8 text-[12.5px] text-[var(--ink3)]">
              You have no address to send from yet. Your workspace administrator sets up your mailbox.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]" data-testid="sender-identities">
              {ordered.map((m) => {
                const kind = KIND[m.type] ?? { label: m.type, icon: AtSign };
                const Icon = kind.icon;
                return (
                  <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--s2)] text-[var(--ink2)]">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[13.5px] font-semibold text-[var(--ink)]">{m.address}</span>
                        {m.type === "USER" && (
                          <span className="rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10.5px] font-semibold text-[var(--accent-ink)]">Default</span>
                        )}
                      </p>
                      <p className="mt-0.5 text-[12px] text-[var(--ink3)]">{kind.label}</p>
                    </div>
                    {m.sendSuspended ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--crit)]/40 bg-[var(--crit-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--crit)]">
                        <Ban className="h-3 w-3" aria-hidden /> Sending paused
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--ok)]/40 bg-[var(--ok-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--ok)]">
                        <CheckCircle2 className="h-3 w-3" aria-hidden /> Can send
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--ink)]">
              <BadgeCheck className="h-4 w-4 text-[var(--accent)]" aria-hidden /> How sending works
            </h2>
            <ul className="mt-3 space-y-2.5 text-[12.5px] text-[var(--ink2)]">
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ok)]" aria-hidden /> New messages are sent from your own mailbox unless you choose another address.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ok)]" aria-hidden /> Every send is checked against your permissions, so a removed permission takes effect at once.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ok)]" aria-hidden /> When sending from an address is paused, it still receives mail. Ask your administrator if you need it back.</li>
            </ul>
          </section>
        </aside>
      </div>
    </SettingsWorkspace>
  );
}
