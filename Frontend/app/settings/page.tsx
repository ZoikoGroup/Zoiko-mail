"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useSendDigest } from "@/lib/notifications-hooks";
import {
  Bell, Sparkles, Loader2, Send, Palette, ArrowRight,
} from "lucide-react";
import { useSignature, useUpdateSignature } from "@/lib/mail-hooks";
import { FileSignature, CheckCircle2 } from "lucide-react";

export default function SettingsPage() {
  const digest = useSendDigest();
  const [digestNote, setDigestNote] = useState<string | null>(null);
  const { data: sigData, isLoading: sigLoading } = useSignature();
  const updateSig = useUpdateSignature();
  const [sigDraft, setSigDraft] = useState("");
  const [sigSaved, setSigSaved] = useState(false);

  useEffect(() => {
    if (!digestNote) return;
    const t = setTimeout(() => setDigestNote(null), 4000);
    return () => clearTimeout(t);
  }, [digestNote]);

  // Sync server value into local draft when it loads
  useEffect(() => {
    if (sigData?.signature != null) setSigDraft(sigData.signature);
  }, [sigData?.signature]);

  useEffect(() => {
    if (!sigSaved) return;
    const t = setTimeout(() => setSigSaved(false), 3000);
    return () => clearTimeout(t);
  }, [sigSaved]);

  const saveSig = () => {
    const value = sigDraft.trim() || null;
    updateSig.mutate(value, { onSuccess: () => setSigSaved(true) });
  };

  const sigChanged = (sigData?.signature ?? "") !== sigDraft;

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <h1 className="font-editorial text-2xl sm:text-3xl font-normal tracking-tight text-[var(--ink)]">
          Settings
        </h1>
        <p className="mt-1 text-sm text-[var(--ink3)]">Appearance, notifications, and preferences.</p>

        {/* Appearance */}
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

        {/* Email Signature */}
        <h2 className="font-mono-num mt-10 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
          <FileSignature className="h-3.5 w-3.5" /> Email Signature
        </h2>
        <div className="zoiko-card mt-3 p-5">
          <div className="text-sm font-medium text-[var(--ink)]">Your signature</div>
          <p className="mt-0.5 text-xs text-[var(--ink3)]">
            Automatically appended to new messages. You can edit or remove it per message.
          </p>
          {sigLoading ? (
            <div className="mt-3 flex items-center gap-2 text-sm text-[var(--ink3)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <textarea
                value={sigDraft}
                onChange={(e) => setSigDraft(e.target.value)}
                placeholder="e.g. John Doe\nSoftware Engineer\njohn@company.com"
                rows={4}
                className="mt-3 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={saveSig}
                  disabled={!sigChanged || updateSig.isPending}
                  className="zoiko-btn sm pri disabled:opacity-50"
                >
                  {updateSig.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Save signature"
                  )}
                </button>
                {sigDraft && (
                  <button
                    onClick={() => { setSigDraft(""); }}
                    className="zoiko-btn sm"
                  >
                    Clear
                  </button>
                )}
                {sigSaved && (
                  <span className="flex items-center gap-1 text-xs text-[var(--ok)]">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Saved
                  </span>
                )}
              </div>
              {sigDraft.trim() && (
                <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--s2)] p-3">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--ink3)]">Preview</div>
                  <pre className="whitespace-pre-wrap font-sans text-sm text-[var(--ink2)]">
                    --{"\n"}{sigDraft}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>

        {/* Notifications section — trigger + link out to the standalone page */}
        <h2 className="font-mono-num mt-10 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
          <Bell className="h-3.5 w-3.5" /> Notifications
        </h2>

        <div className="zoiko-card mt-3 divide-y divide-[var(--border)]">
          <div className="flex items-center justify-between p-5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-[var(--ink)]">Send a digest now</div>
              <div className="text-xs text-[var(--ink3)]">Queue an on-demand summary of what needs your attention.</div>
            </div>
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
              Send digest
            </button>
          </div>

          {digestNote && (
            <div className="bg-[var(--s2)] px-5 py-2 text-xs text-[var(--ink2)]">
              {digestNote}
            </div>
          )}

          <Link
            href="/notifications"
            className="flex items-center justify-between p-5 transition-colors hover:bg-[var(--s2)]"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-[var(--ink)]">View all notifications</div>
              <div className="text-xs text-[var(--ink3)]">See alerts, digests, and other activity from your workspace.</div>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-[var(--ink3)]" />
          </Link>
        </div>

        {/* Preferences — placeholders */}
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