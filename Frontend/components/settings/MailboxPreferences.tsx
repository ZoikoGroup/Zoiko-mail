"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Accessibility, BellRing, CheckCircle2, Clock, Columns2, Eye, FileSignature, Globe, Image as ImageIcon,
  Inbox, Info, Keyboard, Languages, Loader2, Mail, Rows3, Send, ShieldCheck, Users,
} from "lucide-react";
import {
  useMailPreferences,
  type InboxView, type MailPreferences, type MarkReadDelay, type MessageDensity, type ReadingPanePosition,
} from "@/lib/mail-preferences";
import { applyThemePref, followSystemTheme, readThemePref, THEME_EVENT, type ThemePref } from "@/lib/theme";
import { useSignature, useUpdateSignature } from "@/lib/mail-hooks";
import { useProfile, useUpdateProfile } from "@/lib/auth-hooks";
import { useSendDigest } from "@/lib/notifications-hooks";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import { SHOW_COMING_SOON } from "@/lib/feature-flags";
import { SaveActions, SettingsNotice, SoonBadge } from "@/components/settings/SettingsBits";
import type { SettingsSection } from "@/components/settings/sections";

/**
 * Settings → Mailbox Preferences: how Mail lists and opens your mail, how it
 * looks, your signature, language and time zone.
 *
 * Everything is a draft until Save changes, except Appearance, which applies
 * the moment it is chosen so the page shows what you picked. The mail
 * preferences and the theme are remembered in this browser; the signature,
 * language and time zone are saved to the account.
 */

type Draft = {
  prefs: Partial<MailPreferences>;
  signature?: string;
  language?: string;
  timezone?: string;
};

const VIEW_OPTIONS: { value: InboxView; label: string }[] = [
  { value: "all", label: "All messages" },
  { value: "unread", label: "Unread" },
  { value: "starred", label: "Starred" },
];
const PANE_OPTIONS: { value: ReadingPanePosition; label: string }[] = [
  { value: "right", label: "Right side" },
  { value: "bottom", label: "Below the list" },
  { value: "off", label: "Off — open in place of the list" },
];
const DELAY_OPTIONS: { value: MarkReadDelay; label: string }[] = [
  { value: 0, label: "Immediately" },
  { value: 2, label: "2 seconds" },
  { value: 5, label: "5 seconds" },
  { value: null, label: "Never — I mark mail read myself" },
];
const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "es", label: "Español" },
];
const COMMON_ZONES = [
  "UTC", "Europe/London", "Europe/Paris", "Europe/Berlin", "America/New_York", "America/Chicago",
  "America/Denver", "America/Los_Angeles", "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
];

function timeZones(current: string | undefined): string[] {
  let zones: string[] = COMMON_ZONES;
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone");
    if (all?.length) zones = ["UTC", ...all.filter((z) => z !== "UTC")];
  } catch {
    /* Older browsers: the common list. */
  }
  return current && !zones.includes(current) ? [current, ...zones] : zones;
}

const select =
  "h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--ground)] px-3 text-[13px] font-medium text-[var(--ink)] outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] sm:w-[240px]";

export function MailboxPreferences({ section }: { section: SettingsSection }) {
  const { prefs, loaded, save: savePrefs } = useMailPreferences();
  const signature = useSignature();
  const updateSignature = useUpdateSignature();
  const profile = useProfile();
  const updateProfile = useUpdateProfile();

  // Read after mount, like the preferences: the server render has no storage.
  const [savedTheme, setSavedTheme] = useState<ThemePref>("system");
  useEffect(() => {
    const sync = () => setSavedTheme(readThemePref());
    sync();
    window.addEventListener(THEME_EVENT, sync);
    const stopFollowing = followSystemTheme();
    return () => {
      window.removeEventListener(THEME_EVENT, sync);
      stopFollowing();
    };
  }, []);

  const [draft, setDraft] = useState<Draft>({ prefs: {} });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const savedSignature = signature.data?.signature ?? "";
  const savedLanguage = profile.data?.language ?? "en";
  const savedTimezone = profile.data?.timezone ?? "UTC";

  // What the page shows: the saved values with the draft on top.
  const v: MailPreferences = { ...prefs, ...draft.prefs };
  const theme = savedTheme;
  const sig = draft.signature ?? savedSignature;
  const language = draft.language ?? savedLanguage;
  const timezone = draft.timezone ?? savedTimezone;

  const prefsChanged = (Object.keys(draft.prefs) as (keyof MailPreferences)[]).some((k) => draft.prefs[k] !== prefs[k]);
  const sigChanged = draft.signature !== undefined && draft.signature.trim() !== savedSignature.trim();
  const languageChanged = draft.language !== undefined && draft.language !== savedLanguage;
  const timezoneChanged = draft.timezone !== undefined && draft.timezone !== savedTimezone;
  const dirty = prefsChanged || sigChanged || languageChanged || timezoneChanged;

  const setPref = <K extends keyof MailPreferences>(key: K, value: MailPreferences[K]) => {
    setDraft((d) => ({ ...d, prefs: { ...d.prefs, [key]: value } }));
    setSaved(false);
  };
  const setField = (changes: Omit<Partial<Draft>, "prefs">) => {
    setDraft((d) => ({ ...d, ...changes }));
    setSaved(false);
  };

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 3000);
    return () => clearTimeout(t);
  }, [saved]);

  const zones = useMemo(() => timeZones(savedTimezone), [savedTimezone]);

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    setFailure(null);
    // The browser-side settings cannot fail; apply them first.
    if (prefsChanged) savePrefs(draft.prefs);
    const left: Draft = { prefs: {} };
    const problems: string[] = [];
    if (sigChanged) {
      try {
        await updateSignature.mutateAsync(draft.signature!.trim() || null);
      } catch (error) {
        left.signature = draft.signature;
        problems.push(`Signature: ${(error as Error).message}`);
      }
    }
    if (languageChanged || timezoneChanged) {
      try {
        await updateProfile.mutateAsync({
          ...(languageChanged ? { language: draft.language } : {}),
          ...(timezoneChanged ? { timezone: draft.timezone } : {}),
        });
      } catch (error) {
        left.language = draft.language;
        left.timezone = draft.timezone;
        problems.push(`Language and time zone: ${(error as Error).message}`);
      }
    }
    // Keep only what did not save, so Save again retries just that.
    setDraft(left);
    setSaving(false);
    if (problems.length) setFailure(problems.join(" · "));
    else setSaved(true);
  };

  return (
    <SettingsWorkspace
      section={section}
      actions={
        <SaveActions
          dirty={dirty}
          saving={saving}
          saved={saved}
          onDiscard={() => {
            setDraft({ prefs: {} });
            setFailure(null);
          }}
          onSave={() => void save()}
        />
      }
    >
      <SettingsNotice lead="Your preferences, your mailbox." icon={ShieldCheck}>
        Changes here affect only your own mailbox. Security controls and shared mailbox policies remain enforced by your organization.
      </SettingsNotice>

      <p className="-mt-1 min-h-[18px] text-[12px]" role="status" data-testid="save-state">
        {failure ? (
          <span className="text-[var(--crit)]">Some changes were not saved. {failure}</span>
        ) : saved ? (
          <span className="flex items-center gap-1.5 text-[var(--ok)]">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Your preferences were saved.
          </span>
        ) : dirty ? (
          <span className="text-[var(--ink3)]">You have unsaved changes.</span>
        ) : null}
      </p>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Inbox experience" count={4} soonCount={1}>
            <Row icon={Inbox} title="Default inbox view" description="The messages shown when you open Mail.">
              <select aria-label="Default inbox view" className={select} value={v.defaultView} disabled={!loaded}
                onChange={(e) => setPref("defaultView", e.target.value as InboxView)}>
                {VIEW_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Row>
            <Row icon={Columns2} title="Reading pane position" description="Where an opened message appears beside your list.">
              <select aria-label="Reading pane position" className={select} value={v.readingPane} disabled={!loaded}
                onChange={(e) => setPref("readingPane", e.target.value as ReadingPanePosition)}>
                {PANE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Row>
            <Row icon={Users} title="Conversation grouping" description="Keep replies and related messages together in one row." soon />
            <Row icon={Eye} title="Message preview text" description="Show a short excerpt below each subject line.">
              <Toggle label="Message preview text" checked={v.showPreview} disabled={!loaded} onChange={(on) => setPref("showPreview", on)} />
            </Row>
          </Card>

          <Card title="Reading behavior" count={4} soonCount={2}>
            <Row icon={Rows3} title="Message density" description="How much space each message takes in the list.">
              <Segmented<MessageDensity>
                label="Message density"
                value={v.density}
                disabled={!loaded}
                options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]}
                onChange={(d) => setPref("density", d)}
              />
            </Row>
            <Row icon={Clock} title="Mark as read" description="When a message you open stops counting as unread.">
              <select aria-label="Mark as read" className={select} value={String(v.markReadDelay)} disabled={!loaded}
                onChange={(e) => setPref("markReadDelay", (e.target.value === "null" ? null : Number(e.target.value)) as MarkReadDelay)}>
                {DELAY_OPTIONS.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
              </select>
            </Row>
            <Row icon={ImageIcon} title="External images and links" description="Ask before loading images from outside senders." soon />
            <Row icon={Keyboard} title="Keyboard shortcuts" description="Move through Mail with keyboard commands." soon />
          </Card>

          <Card title="Compose & signature" count={1}>
            <div className="px-5 py-4">
              <div className="flex items-start gap-3">
                <RowIcon icon={FileSignature} />
                <div className="min-w-0 flex-1">
                  <label htmlFor="signature" className="text-[13.5px] font-semibold text-[var(--ink)]">Signature</label>
                  <p className="mt-0.5 text-[12px] text-[var(--ink3)]">Added to new messages. You can edit or remove it in each message.</p>
                  <textarea
                    id="signature"
                    rows={4}
                    value={sig}
                    disabled={signature.isLoading}
                    onChange={(e) => setField({ signature: e.target.value })}
                    placeholder={"e.g. Michael Rivera\nOperations Lead\nmichael@acme.com"}
                    className="mt-3 w-full rounded-lg border border-[var(--border)] bg-[var(--ground)] px-3 py-2 text-[13px] text-[var(--ink)] outline-none placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]"
                  />
                  {signature.isError && (
                    <p className="mt-1 text-[12px] text-[var(--crit)]">Could not load your signature ({(signature.error as Error).message}).</p>
                  )}
                </div>
              </div>
            </div>
          </Card>

          <Card title="Language & region" count={2}>
            <Row icon={Languages} title="Language" description="Saved to your account. Zoiko Mail is shown in English for now.">
              <select aria-label="Language" className={select} value={language} disabled={profile.isLoading}
                onChange={(e) => setField({ language: e.target.value })}>
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </Row>
            <Row icon={Globe} title="Time zone" description="Saved to your account.">
              <select aria-label="Time zone" className={select} value={timezone} disabled={profile.isLoading}
                onChange={(e) => setField({ timezone: e.target.value })}>
                {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
              </select>
            </Row>
          </Card>

          <NotificationsCard />

          <Card title="Accessibility" count={1} soonCount={1}>
            <Row icon={Accessibility} title="Accessibility" description="Reduced motion, larger text and higher contrast." soon />
          </Card>
        </div>

        <aside className="flex flex-col gap-4">
          <LivePreview prefs={v} />
          <AppearanceCard value={theme} onChange={(t) => { applyThemePref(t); setSavedTheme(t); }} />
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 className="flex items-center justify-between text-[14px] font-semibold text-[var(--ink)]">
              Policy protections <span className="text-[11.5px] font-medium text-[var(--ink3)]">View only</span>
            </h2>
            <ul className="mt-3 space-y-2.5 text-[12.5px] text-[var(--ink2)]">
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ok)]" aria-hidden /> Shared mailbox access follows the roles your administrator sets.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ok)]" aria-hidden /> Workspace security policies apply whatever you choose here.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ok)]" aria-hidden /> Inbox and appearance preferences are kept in this browser.</li>
            </ul>
          </section>
        </aside>
      </div>
    </SettingsWorkspace>
  );
}

function Card({ title, count, soonCount = 0, children }: { title: string; count: number; /** How many of `count` are Soon rows, hidden unless SHOW_COMING_SOON. */ soonCount?: number; children: ReactNode }) {
  if (!SHOW_COMING_SOON) count -= soonCount;
  if (count <= 0) return null;
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]" aria-label={title}>
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
        <h2 className="text-[15px] font-semibold text-[var(--ink)]">{title}</h2>
        <span className="text-[11.5px] text-[var(--ink3)]">
          {count} preference{count === 1 ? "" : "s"}
        </span>
      </div>
      <div className="divide-y divide-[var(--border)]">{children}</div>
    </section>
  );
}

function RowIcon({ icon: Icon }: { icon: typeof Inbox }) {
  return (
    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--s2)] text-[var(--ink2)]">
      <Icon className="h-4 w-4" aria-hidden />
    </span>
  );
}

/** One setting: icon, what it is, and its control — or a Soon badge when not built yet. */
function Row({ icon, title, description, soon = false, children }: {
  icon: typeof Inbox;
  title: string;
  description: string;
  soon?: boolean;
  children?: ReactNode;
}) {
  if (soon && !SHOW_COMING_SOON) return null;
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 ${soon ? "opacity-70" : ""}`} aria-disabled={soon || undefined}>
      <RowIcon icon={icon} />
      <div className="min-w-[180px] flex-1">
        <p className="text-[13.5px] font-semibold text-[var(--ink)]">{title}</p>
        <p className="mt-0.5 text-[12px] text-[var(--ink3)]">{description}</p>
      </div>
      {soon ? <SoonBadge /> : <div className="w-full sm:w-auto">{children}</div>}
    </div>
  );
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] disabled:opacity-50 ${
        checked ? "bg-[var(--accent)]" : "bg-[var(--s3)]"
      }`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

function Segmented<T extends string>({ label, value, options, disabled, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--ground)] p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`rounded-md px-3.5 py-1.5 text-[12.5px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              active ? "bg-[var(--accent)] text-white" : "text-[var(--ink2)] hover:text-[var(--ink)]"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Actions, not preferences: they happen at once and are not part of Save. */
function NotificationsCard() {
  const digest = useSendDigest();
  const profile = useProfile();
  const updateProfile = useUpdateProfile();
  const [note, setNote] = useState<string | null>(null);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const dailyOn = profile.data?.dailyDigest ?? false;
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 4000);
    return () => clearTimeout(t);
  }, [note]);

  return (
    <Card title="Notifications" count={3} soonCount={1}>
      <Row icon={Send} title="Send a digest now" description={note ?? "An on-demand summary of what needs your attention, added to your notifications."}>
        <button
          type="button"
          className="zoiko-btn"
          disabled={digest.isPending}
          onClick={() =>
            digest.mutate(undefined, {
              onSuccess: () => setNote("Digest requested — it will arrive shortly."),
              onError: () => setNote("Could not request a digest just now."),
            })
          }
        >
          {digest.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
          Send digest
        </button>
      </Row>
      <Row icon={BellRing} title="Desktop notifications" description="Browser notifications for new mail and activity." soon />
      <Row
        icon={Mail}
        title="Daily digest"
        description={dailyError ?? "A summary of your unread mail and notifications, added to your notifications each morning (from 8:00 in your time zone)."}
      >
        <Toggle
          label="Daily digest"
          checked={dailyOn}
          disabled={profile.isLoading || updateProfile.isPending}
          onChange={(on) => {
            setDailyError(null);
            updateProfile.mutate({ dailyDigest: on }, { onError: (error) => setDailyError(`Could not change the daily digest: ${(error as Error).message}`) });
          }}
        />
      </Row>
    </Card>
  );
}

const SAMPLE = [
  { initials: "SM", color: "#2F6FED", name: "Sarah Mitchell", subject: "Q4 Planning — Latest milestones", snippet: "Hello team, here is a summary of the latest project developments…", time: "10:24", unread: true, starred: true },
  { initials: "JC", color: "#7C3AED", name: "James Carter", subject: "Re: Contract review", snippet: "Thanks — I've added my comments to section 4.", time: "09:41", unread: true, starred: false },
  { initials: "LP", color: "#0EA5A4", name: "Lena Park", subject: "Meeting agenda", snippet: "Please review before Thursday's call.", time: "08:15", unread: false, starred: false },
];

/** A sketch of the mail screen with the draft applied, before it is saved. */
function LivePreview({ prefs }: { prefs: MailPreferences }) {
  const rows = SAMPLE.filter((r) => (prefs.defaultView === "unread" ? r.unread : prefs.defaultView === "starred" ? r.starred : true));
  const compact = prefs.density === "compact";
  const viewLabel = VIEW_OPTIONS.find((o) => o.value === prefs.defaultView)!.label;

  const list = (
    <div className="min-w-0 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--ground)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-2.5 py-2 text-[11.5px] font-semibold text-[var(--ink)]">
        <span className="flex items-center gap-1.5"><Inbox className="h-3.5 w-3.5" aria-hidden /> Inbox</span>
        <span className="text-[var(--accent)]">{viewLabel}</span>
      </div>
      {rows.length === 0 && <p className="px-2.5 py-3 text-[11px] text-[var(--ink3)]">Nothing to show.</p>}
      {rows.map((r) => (
        <div key={r.name} className={`flex gap-2 border-b border-[var(--border)] px-2.5 last:border-0 ${compact ? "py-1.5" : "py-2.5"}`}>
          <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${compact ? "h-5 w-5 text-[8px]" : "h-7 w-7 text-[9.5px]"}`} style={{ backgroundColor: r.color }}>
            {r.initials}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex justify-between gap-2 text-[11px]">
              <span className={`truncate ${r.unread ? "font-semibold text-[var(--ink)]" : "text-[var(--ink2)]"}`}>{r.name}</span>
              <span className="shrink-0 text-[var(--ink3)]">{r.time}</span>
            </span>
            <span className="block truncate text-[10.5px] text-[var(--ink2)]">{r.subject}</span>
            {prefs.showPreview && <span className="block truncate text-[10px] text-[var(--ink3)]">{r.snippet}</span>}
          </span>
        </div>
      ))}
    </div>
  );
  const pane = (
    <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--ground)] p-2.5">
      <p className="truncate text-[11.5px] font-semibold text-[var(--ink)]">{SAMPLE[0].subject}</p>
      <p className="mt-1 line-clamp-3 text-[10.5px] text-[var(--ink3)]">{SAMPLE[0].snippet}</p>
    </div>
  );

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" data-testid="live-preview">
      <h2 className="flex items-center justify-between text-[14px] font-semibold text-[var(--ink)]">
        Live layout preview <span className="text-[11px] font-medium text-[var(--ink3)]">Illustrative</span>
      </h2>
      <div className={`mt-3 gap-2 ${prefs.readingPane === "right" ? "grid grid-cols-[1.4fr_1fr]" : "flex flex-col"}`}>
        {list}
        {prefs.readingPane !== "off" && pane}
      </div>
      <p className="mt-3 flex gap-1.5 text-[11.5px] text-[var(--ink3)]">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        {prefs.readingPane === "off"
          ? "With the reading pane off, a message opens in place of the list."
          : "Reading pane and density settings apply to Mail after you save."}
      </p>
    </section>
  );
}

const THEMES: { value: ThemePref; label: string; swatch: ReactNode }[] = [
  { value: "light", label: "Light", swatch: <span className="block h-full w-full rounded bg-[#F4F6FA]"><span className="ml-[45%] block h-full rounded-r bg-white" /></span> },
  { value: "dark", label: "Dark", swatch: <span className="block h-full w-full rounded bg-[#0B1424]"><span className="ml-[45%] block h-full rounded-r bg-[#131F33]" /></span> },
  { value: "system", label: "System", swatch: <span className="flex h-full w-full overflow-hidden rounded"><span className="w-1/2 bg-[#F4F6FA]" /><span className="w-1/2 bg-[#131F33]" /></span> },
];

function AppearanceCard({ value, onChange }: { value: ThemePref; onChange: (value: ThemePref) => void }) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="flex items-center justify-between text-[14px] font-semibold text-[var(--ink)]">
        Appearance <span className="text-[11px] font-medium text-[var(--accent)]">Personal preference</span>
      </h2>
      <div role="radiogroup" aria-label="Appearance" className="mt-3 grid grid-cols-3 gap-2">
        {THEMES.map((t) => {
          const active = t.value === value;
          return (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(t.value)}
              className={`flex flex-col items-center gap-2 rounded-xl border p-2 text-[12px] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                active ? "border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--ink)]" : "border-[var(--border)] text-[var(--ink2)] hover:border-[var(--bstrong)]"
              }`}
            >
              <span className="block h-10 w-full rounded border border-[var(--border)] p-0.5">{t.swatch}</span>
              {t.label}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[11.5px] text-[var(--ink3)]">
        {value === "system" ? "Follows your device's light or dark setting." : "Applies at once and is saved in this browser."}
      </p>
    </section>
  );
}
