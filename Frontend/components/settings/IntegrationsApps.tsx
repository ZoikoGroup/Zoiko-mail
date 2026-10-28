"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity, ArrowRight, Braces, Cloud, Eye, LayoutGrid, Loader2, Lock, MessageSquare, Plug, Plus,
  ShieldCheck, Trash2, Users, Video,
} from "lucide-react";
import { useConnectors } from "@/lib/connectors-hooks";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import { SettingsNotice, SettingsTabs, SoonBadge } from "@/components/settings/SettingsBits";
import { ConnectionDetail, PROVIDER_LABEL, ProviderLogo, StatusPill } from "@/components/settings/ConnectedMailboxes";
import type { SettingsSection } from "@/components/settings/sections";

/**
 * Settings → Integrations & Apps: the services connected to your mailbox,
 * what each may access, and what else could be connected.
 *
 * The apps connected today are the read-only Gmail and Microsoft 365
 * connections (the same ones Connected Mailboxes manages); the rest of the
 * catalogue is shown as concepts until those integrations exist.
 */

type Tab = "connected" | "discover" | "activity";

const CONCEPTS: { name: string; text: string; category: string; icon: typeof Plug; color: string }[] = [
  { name: "Slack", text: "Team notifications for mail that needs attention", category: "Collaboration", icon: MessageSquare, color: "#611f69" },
  { name: "HubSpot", text: "Log conversations to CRM records", category: "Business", icon: Users, color: "#ff7a59" },
  { name: "Salesforce", text: "Link mail to accounts and opportunities", category: "Business", icon: Cloud, color: "#00a1e0" },
  { name: "OneDrive", text: "Attach files from cloud storage", category: "Files", icon: Cloud, color: "#0364b8" },
  { name: "Zoom", text: "Add meeting links to invitations", category: "Meetings", icon: Video, color: "#2d8cff" },
  { name: "Custom webhook", text: "Event callbacks to your own systems", category: "Developer", icon: Braces, color: "#64748b" },
];

export function IntegrationsApps({ section }: { section: SettingsSection }) {
  const { data: accounts = [], isLoading, error } = useConnectors();
  const [tab, setTab] = useState<Tab>("connected");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = accounts.find((a) => a.id === selectedId) ?? accounts[0] ?? null;

  return (
    <SettingsWorkspace
      section={section}
      actions={
        <button type="button" className="zoiko-btn" disabled title="Requesting new integrations is coming soon">
          <Plus className="h-4 w-4" aria-hidden /> Request integration <SoonBadge />
        </button>
      }
    >
      <SettingsTabs<Tab>
        label="Integrations"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "connected", label: "Connected apps", icon: Plug, count: isLoading ? undefined : accounts.length },
          { key: "discover", label: "Discover integrations", icon: LayoutGrid },
          { key: "activity", label: "Activity & audit", icon: Activity },
        ]}
      />

      {tab === "connected" && (
        <>
          <SettingsNotice lead="Least-privilege access." icon={ShieldCheck}>
            Each app gets only the access listed under its permission scope. Connected mail apps are read-only, and you can revoke any of them here.
          </SettingsNotice>
          <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)_280px]">
            <section aria-label="Connected apps" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[15px] font-semibold text-[var(--ink)]">Connections</h2>
                <span className="text-[11.5px] text-[var(--ink3)]">{accounts.length} connected</span>
              </div>
              {isLoading ? (
                <p className="flex items-center gap-2 py-8 text-[12.5px] text-[var(--ink3)]">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading apps…
                </p>
              ) : error ? (
                <p role="alert" className="py-6 text-[12.5px] text-[var(--crit)]">Could not load your apps ({(error as Error).message}).</p>
              ) : accounts.length === 0 ? (
                <div className="py-8 text-center">
                  <Plug className="mx-auto h-8 w-8 text-[var(--ink3)]" aria-hidden />
                  <p className="mt-3 text-[13px] font-medium text-[var(--ink2)]">No apps connected</p>
                  <button type="button" className="zoiko-btn mt-4" onClick={() => setTab("discover")}>
                    Discover integrations <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              ) : (
                <ul className="mt-3 space-y-1.5" data-testid="connected-apps">
                  {accounts.map((a) => {
                    const active = selected?.id === a.id;
                    return (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(a.id)}
                          aria-current={active ? "true" : undefined}
                          className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                            active ? "border-[var(--accent)] bg-[var(--zm-selected,var(--accent-soft))]" : "border-transparent hover:bg-[var(--s2)]"
                          }`}
                        >
                          <ProviderLogo provider={a.provider} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold text-[var(--ink)]">{PROVIDER_LABEL[a.provider] ?? a.provider}</span>
                            <span className="block truncate text-[11.5px] text-[var(--ink3)]">{a.email}</span>
                          </span>
                          <StatusPill value={a.status} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {selected ? (
              <ConnectionDetail key={selected.id} account={selected} onDisconnected={() => setSelectedId(null)} />
            ) : (
              <section className="hidden items-center justify-center rounded-2xl border border-dashed border-[var(--border)] p-10 text-center text-[13px] text-[var(--ink3)] xl:flex">
                Connected apps appear here, with what they can access.
              </section>
            )}

            <aside className="flex flex-col gap-4 xl:col-span-2 2xl:col-span-1">
              <Governance />
            </aside>
          </div>
        </>
      )}

      {tab === "discover" && (
        <>
          <SettingsNotice lead="What you can connect.">
            Gmail and Microsoft 365 are available now. The others are concepts we are exploring; they are not connected to Zoiko Mail.
          </SettingsNotice>
          <section aria-label="Available now">
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink3)]">Available now</h2>
            <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {(["GMAIL", "MICROSOFT_365"] as const).map((p) => (
                <li key={p} className="flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="flex items-center gap-3">
                    <ProviderLogo provider={p} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold text-[var(--ink)]">{PROVIDER_LABEL[p]}</p>
                      <p className="text-[12px] text-[var(--ink3)]">Read-only mail connection</p>
                    </div>
                  </div>
                  <Link href="/mail/settings/connected-mailboxes" className="zoiko-btn mt-4 self-start">
                    Connect <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="Concepts">
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink3)]">Explore connectors</h2>
            <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3" data-testid="concept-connectors">
              {CONCEPTS.map((c) => {
                const Icon = c.icon;
                return (
                  <li key={c.name} className="flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-white" style={{ backgroundColor: c.color }}>
                        <Icon className="h-5 w-5" aria-hidden />
                      </span>
                      <SoonBadge>Concept</SoonBadge>
                    </div>
                    <p className="mt-3 text-[14px] font-semibold text-[var(--ink)]">{c.name}</p>
                    <p className="text-[12px] text-[var(--ink3)]">{c.text}</p>
                    <p className="mt-3 text-[11.5px] text-[var(--ink3)]">{c.category}</p>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      {tab === "activity" && (
        <section className="flex flex-col items-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-14 text-center" data-testid="activity-soon">
          <Activity className="h-10 w-10 text-[var(--ink3)]" aria-hidden />
          <h2 className="mt-4 flex items-center gap-2 text-[16px] font-semibold text-[var(--ink)]">
            Integration audit log <SoonBadge />
          </h2>
          <p className="mt-1 max-w-md text-[13px] text-[var(--ink3)]">
            A record of every connection, scope change and revocation is coming. Until then, each connection&rsquo;s recent activity is shown with its details.
          </p>
          <button type="button" className="zoiko-btn mt-5" onClick={() => setTab("connected")}>
            View connected apps <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </section>
      )}
    </SettingsWorkspace>
  );
}

function Governance() {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--ink)]">
        <ShieldCheck className="h-4 w-4 text-[var(--accent)]" aria-hidden /> Governance & privacy
      </h2>
      <ul className="mt-3 space-y-3 text-[12.5px] text-[var(--ink2)]">
        <li className="flex gap-2"><Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ink3)]" aria-hidden /> Mailbox access is never implicit — each app lists exactly what it may read.</li>
        <li className="flex gap-2"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ink3)]" aria-hidden /> Sign-in tokens are kept in secure storage, never with your workspace data.</li>
        <li className="flex gap-2"><Trash2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ink3)]" aria-hidden /> Revoking an app stops its access straight away.</li>
      </ul>
    </section>
  );
}
