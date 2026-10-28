"use client";

import { useState } from "react";
import {
  AtSign, Download, FileArchive, FolderInput, HardDrive, History, Info, ListChecks, Search, ShieldCheck, Upload,
} from "lucide-react";
import { useMyMailbox } from "@/lib/mail-hooks";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import { SettingsNotice, SettingsTabs, SoonBadge } from "@/components/settings/SettingsBits";
import { ProviderLogo } from "@/components/settings/ConnectedMailboxes";
import type { SettingsSection } from "@/components/settings/sections";

/**
 * Settings → Import & Export: moving mail into and out of your mailbox.
 *
 * Nothing here moves mail yet. Import adapters are planned, and exports are
 * an Owner/Admin request today (the lifecycle API), so a member's own export
 * is not offered. What is real is shown as such: your storage, and an empty
 * job history rather than invented jobs.
 */

type Tab = "import" | "export" | "history";

const SOURCES: { key: string; name: string; text: string; logo: "GMAIL" | "MICROSOFT_365" | "imap" | "file" }[] = [
  { key: "google", name: "Google Workspace", text: "OAuth migration adapter", logo: "GMAIL" },
  { key: "m365", name: "Microsoft 365", text: "Mailbox import adapter", logo: "MICROSOFT_365" },
  { key: "imap", name: "IMAP mailbox", text: "Any mail account with IMAP access", logo: "imap" },
  { key: "mbox", name: "MBOX / EML files", text: "Upload exported mail files", logo: "file" },
];

function gb(bytes: number): string {
  const value = bytes / 1024 ** 3;
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

export function ImportExport({ section }: { section: SettingsSection }) {
  const [tab, setTab] = useState<Tab>("import");
  const [query, setQuery] = useState("");
  const sources = SOURCES.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <SettingsWorkspace
      section={section}
      actions={
        <>
          <button type="button" className="zoiko-btn" disabled title="Exporting your own mail is coming soon">
            <Download className="h-4 w-4" aria-hidden /> New export <SoonBadge />
          </button>
          <button type="button" className="zoiko-btn" disabled title="Importing mail is coming soon">
            <Upload className="h-4 w-4" aria-hidden /> New import <SoonBadge />
          </button>
        </>
      }
    >
      <SettingsTabs<Tab>
        label="Import and export"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "import", label: "Import & migration", icon: Upload },
          { key: "export", label: "Export mail", icon: Download },
          { key: "history", label: "Job history", icon: History, count: 0 },
        ]}
      />

      <SettingsNotice lead="Controlled mail transfers." icon={ShieldCheck}>
        When transfers open, each one will need source authorization, folder mapping and a preflight check before it runs, with every step recorded.
      </SettingsNotice>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          {tab === "import" && (
            <section aria-label="Choose an import source" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-[15px] font-semibold text-[var(--ink)]">Choose an import source</h2>
                  <p className="text-[12px] text-[var(--ink3)]">Each source needs a validated adapter before it can be used.</p>
                </div>
                <FolderInput className="h-5 w-5 text-[var(--ink3)]" aria-hidden />
              </div>
              <div className="relative mt-4">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink3)]" aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search source types…"
                  aria-label="Search source types"
                  className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--ground)] pl-8 pr-3 text-[12.5px] text-[var(--ink)] outline-none placeholder:text-[var(--ink3)] focus:border-[var(--accent)]"
                />
              </div>
              <ul className="mt-3 divide-y divide-[var(--border)]" data-testid="import-sources">
                {sources.length === 0 && <li className="py-4 text-[12.5px] text-[var(--ink3)]">No source matches “{query}”.</li>}
                {sources.map((s) => (
                  <li key={s.key} className="flex items-center gap-3 py-3 opacity-80">
                    {s.logo === "GMAIL" || s.logo === "MICROSOFT_365" ? (
                      <ProviderLogo provider={s.logo} />
                    ) : (
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--s2)] text-[var(--accent)]">
                        {s.logo === "imap" ? <AtSign className="h-5 w-5" aria-hidden /> : <FileArchive className="h-5 w-5" aria-hidden />}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-semibold text-[var(--ink)]">{s.name}</span>
                      <span className="block text-[12px] text-[var(--ink3)]">{s.text}</span>
                    </span>
                    <SoonBadge>Planned</SoonBadge>
                  </li>
                ))}
              </ul>
              <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--s2)] p-4">
                <p className="flex items-center gap-2 text-[13px] font-semibold text-[var(--ink)]">
                  <Info className="h-4 w-4 text-[var(--accent)]" aria-hidden /> Import readiness
                </p>
                <p className="mt-1 text-[12px] text-[var(--ink2)]">
                  An import will start with source authorization, folder mapping, a limited pilot and a dry run. Until import opens, your workspace administrator can help move mail.
                </p>
              </div>
            </section>
          )}

          {tab === "export" && (
            <section aria-label="Export mail" className="flex flex-col items-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-14 text-center" data-testid="export-soon">
              <Download className="h-10 w-10 text-[var(--ink3)]" aria-hidden />
              <h2 className="mt-4 flex items-center gap-2 text-[16px] font-semibold text-[var(--ink)]">
                Export your mail <SoonBadge />
              </h2>
              <p className="mt-1 max-w-md text-[13px] text-[var(--ink3)]">
                Exporting your own mailbox is coming. Today, exports are requested and approved by your workspace&rsquo;s owners and administrators — ask them if you need a copy of your mail.
              </p>
            </section>
          )}

          {tab === "history" && (
            <section aria-label="Transfer jobs" className="flex flex-col items-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-14 text-center" data-testid="job-history">
              <ListChecks className="h-10 w-10 text-[var(--ink3)]" aria-hidden />
              <h2 className="mt-4 text-[16px] font-semibold text-[var(--ink)]">No transfer jobs yet</h2>
              <p className="mt-1 max-w-md text-[13px] text-[var(--ink3)]">
                Imports and exports you start will be listed here, with every recorded step.
              </p>
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <StorageCard />
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--ink)]">
              <ShieldCheck className="h-4 w-4 text-[var(--accent)]" aria-hidden /> Preflight required
            </h2>
            <p className="mt-2 text-[12.5px] text-[var(--ink2)]">Source authorization · folder mapping · pilot validation</p>
          </section>
        </aside>
      </div>
    </SettingsWorkspace>
  );
}

function StorageCard() {
  const { data: mailbox, isLoading } = useMyMailbox();
  const used = mailbox?.storageUsed ?? 0;
  const limit = mailbox?.storageLimit ?? 0;
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5" data-testid="storage-card">
      <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--ink)]">
        <HardDrive className="h-4 w-4 text-[var(--accent)]" aria-hidden /> Storage used
      </h2>
      <p className="mt-2 text-[20px] font-bold text-[var(--ink)]">
        {isLoading ? "…" : `${gb(used)} / ${gb(limit)} GB`}
      </p>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--s3)]"
        role="progressbar"
        aria-label="Mailbox storage used"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div
          className={`h-full rounded-full ${pct > 90 ? "bg-[var(--crit)]" : pct > 75 ? "bg-[var(--warn)]" : "bg-[var(--accent)]"}`}
          style={{ width: `${Math.max(pct, used > 0 ? 2 : 0)}%` }}
        />
      </div>
      <p className="mt-2 text-[11.5px] text-[var(--ink3)]">An import counts toward this limit.</p>
    </section>
  );
}
