"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import {
  useNotifications,
  useMarkNotificationRead,
  useSendDigest,
} from "@/lib/notifications-hooks";
import {
  Bell, Sparkles, MailCheck, Loader2, CheckCircle2, AlertCircle, Send, Palette,
} from "lucide-react";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function SettingsPage() {
  const { data: notifications = [], isLoading, error } = useNotifications(false);
  const markRead = useMarkNotificationRead();
  const digest = useSendDigest();
  const [digestNote, setDigestNote] = useState<string | null>(null);

  useEffect(() => {
    if (!digestNote) return;
    const t = setTimeout(() => setDigestNote(null), 4000);
    return () => clearTimeout(t);
  }, [digestNote]);

  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <h1 className="font-editorial text-2xl sm:text-3xl font-normal tracking-tight text-[var(--ink)]">
          Settings
        </h1>
        <p className="mt-1 text-sm text-[var(--ink3)]">Appearance, notifications, and preferences.</p>

        {/* Appearance — real (client-side) */}
        <h2 className="font-mono-num mt-8 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
          <Palette className="h-3.5 w-3.5" /> Appearance
        </h2>
        <div className="zoiko-card mt-3 flex items-center justify-between p-5">
          <div>
            <div className="text-sm font-medium text-[var(--ink)]">Theme</div>
            <div className="text-xs text-[var(--ink3)]">Switch between light and dark. Saved to this device.</div>
          </div>
          <ThemeToggle />
        </div>

        {/* Notifications — real */}
        <h2 className="font-mono-num mt-10 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
          <Bell className="h-3.5 w-3.5" /> Notifications
          {unread > 0 && <span className="zoiko-pill accent">{unread} unread</span>}
        </h2>

        <div className="zoiko-card mt-3">
          <div className="flex items-center justify-between border-b border-[var(--border)] p-4">
            <span className="text-sm text-[var(--ink2)]">Get a summary of what needs your attention.</span>
            <button
              onClick={() =>
                digest.mutate(undefined, {
                  onSuccess: () => setDigestNote("Digest requested — it'll arrive shortly."),
                  onError: () => setDigestNote("Couldn't request a digest just now."),
                })
              }
              disabled={digest.isPending}
              className="zoiko-btn sm disabled:opacity-50"
            >
              {digest.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send digest now
            </button>
          </div>

          {digestNote && (
            <div className="border-b border-[var(--border)] bg-[var(--s2)] px-4 py-2 text-xs text-[var(--ink2)]">
              {digestNote}
            </div>
          )}

          <div className="max-h-96 overflow-y-auto">
            {isLoading && (
              <div className="flex items-center gap-2 p-5 text-sm text-[var(--ink3)]">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 p-4 text-sm text-[var(--crit)]">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> Couldn&rsquo;t load notifications.
              </div>
            )}
            {!isLoading && !error && notifications.length === 0 && (
              <div className="flex flex-col items-center py-12 text-center text-[var(--ink3)]">
                <MailCheck className="h-8 w-8 text-[var(--ok)]" />
                <p className="mt-2 text-sm">You&rsquo;re all caught up.</p>
              </div>
            )}
            <ul className="divide-y divide-[var(--border)]">
              {notifications.map((n) => (
                <li key={n.id} className={`flex items-start gap-3 p-4 ${n.readAt ? "" : "bg-[var(--s2)]"}`}>
                  {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />}
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm ${n.readAt ? "text-[var(--ink2)]" : "font-semibold text-[var(--ink)]"}`}>
                      {n.title}
                    </div>
                    <div className="text-xs text-[var(--ink3)]">{n.body}</div>
                    <div className="mt-0.5 text-[11px] text-[var(--ink3)]">{timeAgo(n.createdAt)}</div>
                  </div>
                  {!n.readAt && (
                    <button
                      onClick={() => markRead.mutate(n.id)}
                      className="shrink-0 text-xs font-medium text-[var(--accent-ink)] hover:underline"
                    >
                      Mark read
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Preferences — not yet backed; honest placeholders */}
        <h2 className="font-mono-num mt-10 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
          <Sparkles className="h-3.5 w-3.5" /> Preferences
        </h2>
        <div className="zoiko-card mt-3 divide-y divide-[var(--border)]">
          <PreferenceRow title="Desktop notifications" desc="Show browser notifications for new activity." />
          <PreferenceRow title="Daily digest" desc="Automatically receive a once-a-day summary." />
          <PreferenceRow title="AI suggestions" desc="Let AI suggest replies and summaries." />
        </div>
        <p className="mt-2 text-xs text-[var(--ink3)]">
          Preference toggles are coming once account settings are stored server-side.
        </p>
      </div>
    </AppShell>
  );
}

// A disabled toggle placeholder — visibly not-yet-available (no fake persistence).
function PreferenceRow({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex items-center gap-4 p-5 opacity-70">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--ink)]">{title}</span>
          <span className="zoiko-pill nu">Soon</span>
        </div>
        <p className="mt-0.5 text-xs text-[var(--ink3)]">{desc}</p>
      </div>
      <span className="zoiko-toggle lock" aria-disabled="true">
        <i />
      </span>
    </div>
  );
}