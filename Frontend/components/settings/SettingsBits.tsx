"use client";

import type { ReactNode } from "react";
import { Check, Info, Loader2, type LucideIcon } from "lucide-react";
import type { SettingsSection } from "@/components/settings/sections";

/**
 * The pieces every Settings page is built from, so the six sections read as
 * one place: the header (icon, "SETTINGS / …", title, actions), the notice
 * strip beneath it, and the "Soon" treatment for what is not built yet.
 */

/** Icon tile, "SETTINGS / <eyebrow>", title and subtitle, with the page's actions on the right. */
export function SettingsHeader({ section, actions }: { section: SettingsSection; actions?: ReactNode }) {
  const Icon = section.icon;
  return (
    <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[var(--accent)]/40 bg-[var(--accent-soft)] text-[var(--accent-ink)] sm:h-14 sm:w-14">
        <Icon className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--accent-ink)]">
          Settings / {section.eyebrow}
        </p>
        <h1 className="mt-1 text-[21px] font-bold leading-tight text-[var(--ink)] sm:text-[26px]">{section.title}</h1>
        <p className="mt-1 text-[13px] text-[var(--ink2)] sm:text-[13.5px]">{section.subtitle}</p>
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">{actions}</div>}
    </header>
  );
}

/** The blue strip under a header: a bold lead, the detail, and an optional note on the right. */
export function SettingsNotice({
  lead,
  children,
  aside,
  icon: Icon = Info,
}: {
  lead: string;
  children: ReactNode;
  aside?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent-soft)] px-4 py-3 text-[12.5px] text-[var(--ink2)]">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-semibold text-[var(--ink)]">{lead}</span> {children}
      </p>
      {aside && <span className="hidden shrink-0 text-[11.5px] text-[var(--ink3)] sm:inline">{aside}</span>}
    </div>
  );
}

/** The same pill the folder column uses for Folders. */
export function SoonBadge({ children = "Soon" }: { children?: string }) {
  return (
    <span className="shrink-0 rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--ink3)]">
      {children}
    </span>
  );
}

/** A setting that is not built yet: shown so the page is honest about what is coming, never clickable. */
export function SoonRow({
  icon: Icon,
  title,
  description,
  badge,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-4 opacity-70" aria-disabled="true">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--s2)] text-[var(--ink3)]">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-[var(--ink)]">{title}</p>
        <p className="mt-0.5 text-[12px] text-[var(--ink3)]">{description}</p>
      </div>
      <SoonBadge>{badge}</SoonBadge>
    </div>
  );
}

/** The underlined tab strip under a header (Integrations, Import & Export). */
export function SettingsTabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string;
  tabs: { key: T; label: string; icon: LucideIcon; count?: number }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-6 overflow-x-auto border-b border-[var(--border)]">
      {tabs.map((t) => {
        const active = t.key === value;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-1 pb-3 pt-1 text-[13.5px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              active ? "border-[var(--accent)] text-[var(--ink)]" : "border-transparent text-[var(--ink3)] hover:text-[var(--ink)]"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden /> {t.label}
            {t.count !== undefined && (
              <span className="rounded-md bg-[var(--accent)] px-1.5 py-0.5 text-[10.5px] font-semibold text-white">{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Discard / Save changes, for a page that edits a draft. */
export function SaveActions({
  dirty,
  invalid = false,
  saving = false,
  saved = false,
  onDiscard,
  onSave,
}: {
  dirty: boolean;
  /** A field needs fixing first: Save stays off, Discard does not. */
  invalid?: boolean;
  saving?: boolean;
  /** Shows a brief "Saved" in place of the save label. */
  saved?: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <>
      <button type="button" className="zoiko-btn" onClick={onDiscard} disabled={!dirty || saving}>
        Discard
      </button>
      <button type="button" className="zoiko-btn pri" onClick={onSave} disabled={!dirty || invalid || saving}>
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Check className="h-3.5 w-3.5" aria-hidden />
        )}
        {saving ? "Saving…" : saved && !dirty ? "Saved" : "Save changes"}
      </button>
    </>
  );
}
