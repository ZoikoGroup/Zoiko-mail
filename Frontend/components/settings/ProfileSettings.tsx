"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  Building2, CheckCircle2, ChevronRight, Fingerprint, KeyRound, Loader2, Monitor,
  MonitorSmartphone, ShieldCheck,
} from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { useChangePassword, useLogoutAll, useMe, useProfile, useUpdateProfile } from "@/lib/auth-hooks";
import { initials } from "@/lib/useMemberShell";
import { MfaSettings } from "@/components/account/MfaSettings";
import { PasswordRequirements } from "@/components/auth";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";
import { SHOW_COMING_SOON } from "@/lib/feature-flags";
import { SaveActions, SettingsNotice, SoonBadge, SoonRow } from "@/components/settings/SettingsBits";
import type { SettingsSection } from "@/components/settings/sections";

/**
 * Settings → Profile: who you are to your workspace, and how you sign in.
 *
 * Replaces /account. Name and phone are saved to the account (PATCH
 * /users/me); the sign-in address and role belong to the workspace, so they
 * are shown and not offered for editing.
 */

const input =
  "h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--ground)] px-3 text-[13.5px] text-[var(--ink)] outline-none placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-70";
const label = "mb-1.5 block text-[12.5px] font-semibold text-[var(--ink)]";
const hint = "mt-1 text-[11.5px] text-[var(--ink3)]";
const fieldError = "mt-1 text-[11.5px] text-[var(--crit)]";

/** The server's rule (user.schema.ts), applied to the number with its spacing removed. */
const PHONE = /^\+?[1-9]\d{6,14}$/;
const compactPhone = (value: string) => value.replace(/[\s().-]/g, "");

const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

/** "3 March 2026", or nothing while loading — formatting an invalid date would throw. */
function memberSince(iso: string | undefined): string {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3.5">
        <h2 className="text-[15px] font-semibold text-[var(--ink)]">{title}</h2>
        {aside && <span className="text-[11.5px] text-[var(--ink3)]">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

export function ProfileSettings({ section }: { section: SettingsSection }) {
  const { data: me } = useMe();
  const profile = useProfile();
  const update = useUpdateProfile();

  const [draft, setDraft] = useState<{ displayName?: string; phoneNumber?: string }>({});
  const [saved, setSaved] = useState(false);

  const savedName = profile.data?.displayName ?? "";
  const savedPhone = profile.data?.phoneNumber ?? "";
  const name = draft.displayName ?? savedName;
  const phone = draft.phoneNumber ?? savedPhone;

  const nameChanged = draft.displayName !== undefined && name.trim() !== savedName;
  const phoneChanged = draft.phoneNumber !== undefined && compactPhone(phone) !== savedPhone;
  const dirty = nameChanged || phoneChanged;

  const nameProblem = !name.trim() ? "Enter the name colleagues will see." : name.trim().length > 120 ? "Use 120 characters or fewer." : null;
  const phoneProblem = phone.trim() && !PHONE.test(compactPhone(phone)) ? "Enter a number with its country code, such as +44 20 7946 0958." : null;

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 3000);
    return () => clearTimeout(t);
  }, [saved]);

  const save = () => {
    if (!dirty || nameProblem || phoneProblem || update.isPending) return;
    update.mutate(
      {
        ...(nameChanged ? { displayName: name.trim() } : {}),
        ...(phoneChanged ? { phoneNumber: phone.trim() ? compactPhone(phone) : null } : {}),
      },
      {
        onSuccess: () => {
          setDraft({});
          setSaved(true);
        },
      }
    );
  };

  return (
    <SettingsWorkspace
      section={section}
      actions={
        <SaveActions
          dirty={dirty}
          invalid={Boolean(nameProblem || phoneProblem)}
          saving={update.isPending}
          saved={saved}
          onDiscard={() => {
            setDraft({});
            update.reset();
          }}
          onSave={save}
        />
      }
    >
      <SettingsNotice lead="Your account, your sign-in." icon={ShieldCheck}>
        Your name and phone number are visible to colleagues in this workspace. Your sign-in address and role are managed by your workspace administrator.
      </SettingsNotice>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Personal details" aside="Visible to your workspace">
            <div className="p-5" data-testid="profile-details">
              <div className="flex flex-wrap items-center gap-4">
                <span className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[20px] font-semibold text-white">
                  {initials(name || me?.displayName, me?.email)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[17px] font-semibold text-[var(--ink)]">{name || me?.displayName || "—"}</p>
                  <p className="truncate text-[13px] text-[var(--ink3)]">{me?.email ?? "…"}</p>
                  {me && (
                    <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent-ink)]">
                      <Building2 className="h-3 w-3" aria-hidden />
                      {titleCase(me.membership.role)} · {me.tenant.name}
                    </span>
                  )}
                </div>
                {SHOW_COMING_SOON && (
                  <span className="flex items-center gap-2 text-[12px] text-[var(--ink3)]" title="Uploading a photo is coming soon">
                  Profile photo <SoonBadge />
                </span>
                )}
              </div>

              {profile.isError && (
                <p role="alert" className="mt-4 text-[12.5px] text-[var(--crit)]">
                  Could not load your details ({(profile.error as Error).message}).
                </p>
              )}

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="profile-name" className={label}>Display name</label>
                  <input
                    id="profile-name"
                    className={input}
                    value={name}
                    maxLength={120}
                    autoComplete="name"
                    disabled={profile.isLoading}
                    onChange={(e) => setDraft((d) => ({ ...d, displayName: e.target.value }))}
                    aria-invalid={Boolean(nameChanged && nameProblem)}
                  />
                  {draft.displayName !== undefined && nameProblem ? (
                    <p className={fieldError}>{nameProblem}</p>
                  ) : (
                    <p className={hint}>Shown on mail you send and across the workspace.</p>
                  )}
                </div>
                <div>
                  <label htmlFor="profile-phone" className={label}>Phone number</label>
                  <input
                    id="profile-phone"
                    className={input}
                    value={phone}
                    type="tel"
                    autoComplete="tel"
                    placeholder="+44 20 7946 0958"
                    disabled={profile.isLoading}
                    onChange={(e) => setDraft((d) => ({ ...d, phoneNumber: e.target.value }))}
                    aria-invalid={Boolean(phoneProblem)}
                  />
                  {phoneProblem ? <p className={fieldError}>{phoneProblem}</p> : <p className={hint}>Optional.</p>}
                </div>
                <div>
                  <label htmlFor="profile-email" className={label}>Sign-in address</label>
                  <input id="profile-email" className={input} value={me?.email ?? ""} disabled readOnly />
                  <p className={hint}>Managed by your workspace administrator.</p>
                </div>
                <div>
                  <label htmlFor="profile-since" className={label}>Member since</label>
                  <input
                    id="profile-since"
                    className={input}
                    value={memberSince(profile.data?.createdAt)}
                    disabled
                    readOnly
                  />
                </div>
              </div>

              <p className="mt-4 min-h-[18px] text-[12px]" role="status" data-testid="profile-save-state">
                {update.error ? (
                  <span className="text-[var(--crit)]">{(update.error as Error).message}</span>
                ) : saved ? (
                  <span className="flex items-center gap-1.5 text-[var(--ok)]">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Your details were saved.
                  </span>
                ) : dirty ? (
                  <span className="text-[var(--ink3)]">You have unsaved changes.</span>
                ) : null}
              </p>
            </div>
          </Card>

          <Card title="Sign-in & security" aside="Applies to every device">
            <div className="divide-y divide-[var(--border)]">
              <MfaSettings />
              <PasswordRow />
              <SignOutEverywhereRow />
              <SoonRow icon={Monitor} title="Active sessions" description="See every browser and device you are signed in on, and end one at a time." />
              <SoonRow icon={Fingerprint} title="ZoikoID" description="Link your ZoikoID for single sign-on across Zoiko." />
            </div>
          </Card>
        </div>

        <aside className="flex flex-col gap-4">
          <WorkspaceCard />
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--ink)]">
              <ShieldCheck className="h-4 w-4 text-[var(--accent)]" aria-hidden /> Organization policy applies
            </h2>
            <ul className="mt-3 space-y-2.5 text-[12.5px] text-[var(--ink2)]">
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ok)]" aria-hidden /> Your role and sign-in address are set by your administrator.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ok)]" aria-hidden /> Some roles must use two-step verification.</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ok)]" aria-hidden /> Changes to your details are recorded in the workspace audit log.</li>
            </ul>
          </section>
        </aside>
      </div>
    </SettingsWorkspace>
  );
}

/** The workspace this session is in, and the way to another one. */
function WorkspaceCard() {
  const { data: me } = useMe();
  if (!me) return null;
  // Offered only when there is somewhere to go, as in the account menu.
  const canSwitch = (me.workspaceCount ?? 1) > 1;
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5" data-testid="workspace-card">
      <h2 className="text-[14px] font-semibold text-[var(--ink)]">Workspace</h2>
      <div className="mt-3 flex items-center gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-[15px] font-bold text-white">
          {me.tenant.name.trim().charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-semibold text-[var(--ink)]">{me.tenant.name}</p>
          <p className="text-[12px] text-[var(--ink3)]">{titleCase(me.tenant.planCode)} plan</p>
        </div>
      </div>
      <dl className="mt-4 space-y-2 text-[12.5px]">
        <div className="flex justify-between gap-3">
          <dt className="text-[var(--ink3)]">Your role</dt>
          <dd className="font-medium text-[var(--ink)]">{titleCase(me.membership.role)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-[var(--ink3)]">Workspaces you belong to</dt>
          <dd className="font-medium text-[var(--ink)]">{me.workspaceCount ?? 1}</dd>
        </div>
      </dl>
      {canSwitch && (
        <Link href="/select-workspace" className="zoiko-btn mt-4 w-full justify-center">
          Switch workspace <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      )}
    </section>
  );
}

function RowShell({ icon: Icon, title, description, action, children }: {
  icon: typeof KeyRound;
  title: string;
  description: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--s2)] text-[var(--ink2)]">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-[var(--ink)]">{title}</p>
          <p className="text-[12px] text-[var(--ink3)]">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/** Change password, folded away until asked for. Same rules as the old form. */
function PasswordRow() {
  const change = useChangePassword();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const [done, setDone] = useState(false);

  const setField = (field: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
    setDone(false);
  };

  const close = () => {
    setOpen(false);
    setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    setErrors({});
    change.reset();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (!form.currentPassword) next.currentPassword = "Enter your current password.";
    if (!form.newPassword) next.newPassword = "Enter a new password.";
    else if (form.newPassword.length < 8) next.newPassword = "Use at least 8 characters.";
    else if (form.newPassword === form.currentPassword) next.newPassword = "Choose a password different from your current one.";
    if (!form.confirmPassword) next.confirmPassword = "Type the new password again.";
    else if (form.confirmPassword !== form.newPassword) next.confirmPassword = "The passwords do not match.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    change.mutate(
      { currentPassword: form.currentPassword, newPassword: form.newPassword },
      {
        onSuccess: () => {
          close();
          setDone(true);
        },
      }
    );
  };

  const failure = change.error instanceof ApiError ? change.error.message : change.error ? "Something went wrong." : null;

  const field = (key: keyof typeof form, text: string, autoComplete: string) => (
    <div>
      <label htmlFor={`pw-${key}`} className={label}>{text}</label>
      <input
        id={`pw-${key}`}
        type="password"
        className={input}
        autoComplete={autoComplete}
        value={form[key]}
        disabled={change.isPending}
        onChange={(e) => setField(key, e.target.value)}
        aria-invalid={Boolean(errors[key])}
      />
      {errors[key] && <p className={fieldError}>{errors[key]}</p>}
    </div>
  );

  return (
    <RowShell
      icon={KeyRound}
      title="Password"
      description={done ? "Your password was changed." : "The password you sign in with."}
      action={
        !open && (
          <button type="button" className="zoiko-btn sm" onClick={() => setOpen(true)}>
            Change password
          </button>
        )
      }
    >
      {open && (
        <form onSubmit={submit} noValidate className="mt-4 grid max-w-xl gap-4" data-testid="change-password">
          {field("currentPassword", "Current password", "current-password")}
          <div>
            {field("newPassword", "New password", "new-password")}
            <PasswordRequirements password={form.newPassword} className="mt-2" />
          </div>
          {field("confirmPassword", "Confirm new password", "new-password")}
          {failure && (
            <p role="alert" className="rounded-lg bg-[var(--crit-soft)] px-3 py-2 text-[12px] text-[var(--crit)]">{failure}</p>
          )}
          <div className="flex gap-2">
            <button type="submit" className="zoiko-btn pri" disabled={change.isPending}>
              {change.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {change.isPending ? "Updating…" : "Update password"}
            </button>
            <button type="button" className="zoiko-btn" onClick={close} disabled={change.isPending}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </RowShell>
  );
}

/** Ends every session, this one included — so it asks first. */
function SignOutEverywhereRow() {
  const logoutAll = useLogoutAll();
  const [confirming, setConfirming] = useState(false);
  return (
    <RowShell
      icon={MonitorSmartphone}
      title="Sign out everywhere"
      description="End every session for this account, on every browser and device — including this one."
      action={
        <button type="button" className="zoiko-btn sm crit" onClick={() => setConfirming(true)} disabled={logoutAll.isPending}>
          {logoutAll.isPending ? "Signing out…" : "Sign out everywhere"}
        </button>
      }
    >
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          logoutAll.mutate();
        }}
        title="Sign out on every device?"
        message="Every session for this account ends, on every browser and device — including this one. Anyone signed in elsewhere will have to sign in again."
        confirmLabel="Sign out everywhere"
        loading={logoutAll.isPending}
      />
    </RowShell>
  );
}
