"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import {
  acceptInvitation,
  claimInvitation,
  lookupInvitation,
  type InvitationLookup,
} from "@/lib/owner-api";
import { isLoggedIn } from "@/lib/auth-storage";
import { ApiError } from "@/lib/api-client";
import { logout } from "@/lib/auth-api";

/**
 * Accepting an invitation, or setting up a new mailbox from its setup link.
 *
 * Served at /invitation/accept and, for links issued before that, at
 * /accept-invitation. The token in the link is the credential, the way a
 * password-reset link is. What happens next depends on whether the address
 * already has an account, which the server answers before anyone signs in:
 *
 *   no account yet  → choose a password here, then sign in
 *   account exists  → sign in first, then accept from their own session
 *
 * The second branch is not a convenience. An admin can invite any address, so
 * a link that could set a password on an existing account would make "invite"
 * a way to take one over.
 *
 * The token is only ever held in memory: never written to local or session
 * storage, never sent as a query string to the API.
 */

type Phase =
  | "loading"
  | "set-password"     // no account yet: choose one
  | "needs-signin"     // account exists: sign in and accept
  | "accepting"        // signed in already: accept from this session
  | "already-accepted" // this link was used earlier: sign in
  | "done"
  | "expired"
  | "invalid"          // never issued, replaced by a newer link, or revoked
  | "error"
  | "no-token";

/** The server's password rule for a new account, checked as they type. */
const RULES: { label: string; test: (p: string) => boolean }[] = [
  { label: "At least 12 characters", test: (p) => p.length >= 12 },
  { label: "An uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { label: "A lowercase letter", test: (p) => /[a-z]/.test(p) },
  { label: "A number", test: (p) => /[0-9]/.test(p) },
];

const REDIRECT_MS = 2000;

function reasonOf(error: unknown): string | undefined {
  if (!(error instanceof ApiError) || Array.isArray(error.details)) return undefined;
  return (error.details as { reason?: string } | undefined)?.reason;
}

/** Which screen a failed lookup or claim should show. */
function phaseForError(error: unknown): Phase {
  if (error instanceof ApiError) {
    if (error.status === 410) return "expired";
    if (error.status === 401) return "invalid";
    if (reasonOf(error) === "ALREADY_ACCEPTED") return "already-accepted";
  }
  return "error";
}

const NOTICE_TONES = {
  ok: "bg-green-100 dark:bg-green-900/30",
  warn: "bg-amber-100 dark:bg-amber-900/30",
  crit: "bg-red-100 dark:bg-red-900/30",
  info: "bg-blue-100 dark:bg-blue-900/30",
} as const;

/** One outcome: an icon, what happened, and where to go next. */
function Notice({ icon, tone, title, children, action }: {
  icon: string;
  tone: keyof typeof NOTICE_TONES;
  title: string;
  children: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <div className="text-center" role={tone === "crit" ? "alert" : "status"}>
      <div aria-hidden className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full text-2xl ${NOTICE_TONES[tone]}`}>
        {icon}
      </div>
      <h1 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{children}</p>
      {action}
    </div>
  );
}

function AcceptInvitationInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";

  const [phase, setPhase] = useState<Phase>(!token ? "no-token" : "loading");
  const [invite, setInvite] = useState<InvitationLookup | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [busy, setBusy] = useState(false);
  // A second click while the first request is in flight must not send another.
  const submitting = useRef(false);

  // One lookup per token. React StrictMode double-invokes effects in
  // development; a late setState after the second is a harmless no-op.
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    if (!token || attempted.current === token) return;
    attempted.current = token;

    // Look the invitation up before looking at any session. The browser that
    // opens a link is often the one the inviter used, holding a session that
    // belongs to somebody else; trusting it first sends a new user down the
    // signed-in path, where they are told to authenticate with an account
    // they have never had.
    lookupInvitation(token)
      .then(async (found) => {
        setInvite(found);
        if (found.alreadyAccepted) {
          setPhase("already-accepted");
          return;
        }
        if (found.needsPassword) {
          setPhase("set-password");
          return;
        }
        // The address already has an account. A live session that belongs to
        // that person can accept right now; anything else signs in first.
        if (isLoggedIn()) {
          setPhase("accepting");
          try {
            await acceptInvitation(token);
            // Sign out so they return with the new membership on their token.
            await logout();
            window.location.href = "/login";
            return;
          } catch {
            // Expired, or belonging to someone else: the sign-in the
            // invitation needs, not an error to show.
          }
        }
        setPhase("needs-signin");
      })
      .catch((e: unknown) => {
        setErrorMsg(e instanceof Error ? e.message : "");
        setPhase(phaseForError(e));
      });
  }, [token]);

  useEffect(() => {
    if (phase !== "done") return;
    // To sign in, with the password they just chose: it proves the password
    // works before they depend on it, and MFA enrolment lives on that path.
    const timer = window.setTimeout(() => router.push("/login"), REDIRECT_MS);
    return () => window.clearTimeout(timer);
  }, [phase, router]);

  const failing = RULES.filter((rule) => !rule.test(password));
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = failing.length === 0 && confirm.length > 0 && !mismatch && !busy;

  const submit = async () => {
    setTouched(true);
    if (submitting.current || !canSubmit) return;
    submitting.current = true;
    setErrorMsg("");
    setBusy(true);
    try {
      await claimInvitation(token, password);
      setPassword("");
      setConfirm("");
      setPhase("done");
    } catch (e) {
      const next = phaseForError(e);
      if (next === "error" || (e instanceof ApiError && e.status === 400)) {
        // A rule the server enforces that this screen did not catch, or a
        // transient failure: stay here so they can correct it and try again.
        setErrorMsg(e instanceof Error && e.message ? e.message : "Could not set your password. Try again.");
      } else {
        setPhase(next);
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const field =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
  const fieldLabel = "mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300";
  const primary =
    "mt-6 inline-block rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-700";
  const secondary =
    "mt-6 inline-block rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";

  return (
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl dark:border-slate-800 dark:bg-slate-950">
      <div className="mb-6 text-center">
        <Image
          src="/ZoikoMail_Logo_DarkBG_PNG.png"
          width={400}
          height={100}
          className="mx-auto h-12 w-auto"
          alt="Zoiko Mail"
          priority
        />
      </div>

      {(phase === "loading" || phase === "accepting") && (
        <div className="text-center" role="status">
          <div aria-hidden className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {phase === "accepting" ? "Accepting your invitation…" : "Checking your invitation…"}
          </p>
        </div>
      )}

      {phase === "set-password" && invite && (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h1 className="text-center text-xl font-semibold text-slate-900 dark:text-white">
            You&apos;re invited to Zoiko Mail
          </h1>
          <p className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
            Set a password to start using your account in <strong>{invite.tenantName}</strong>.
          </p>

          <div className="mt-6 space-y-4">
            <div>
              <label htmlFor="invite-email" className={fieldLabel}>Email address</label>
              <input id="invite-email" type="email" readOnly value={invite.email} autoComplete="username" className={`${field} bg-slate-50 dark:bg-slate-800`} />
              <p className="mt-1 text-[11px] text-slate-400">You sign in with this address.</p>
            </div>

            <div>
              <label htmlFor="new-password" className={fieldLabel}>Password</label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                className={field}
                value={password}
                disabled={busy}
                aria-invalid={touched && failing.length > 0}
                aria-describedby="password-rules"
                onChange={(event) => setPassword(event.target.value)}
              />
              <ul id="password-rules" className="mt-2 space-y-0.5" aria-label="Password requirements">
                {RULES.map((rule) => {
                  const met = rule.test(password);
                  return (
                    <li
                      key={rule.label}
                      className={`flex items-center gap-1.5 text-[12px] ${met ? "text-green-700 dark:text-green-400" : touched ? "text-red-600 dark:text-red-400" : "text-slate-500 dark:text-slate-400"}`}
                    >
                      <span aria-hidden>{met ? "✓" : "•"}</span>
                      {rule.label}
                      <span className="sr-only">{met ? " (met)" : " (not met yet)"}</span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div>
              <label htmlFor="confirm-password" className={fieldLabel}>Confirm password</label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                className={field}
                value={confirm}
                disabled={busy}
                aria-invalid={mismatch || (touched && confirm.length === 0)}
                onChange={(event) => setConfirm(event.target.value)}
              />
              {mismatch ? (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">Passwords do not match.</p>
              ) : touched && confirm.length === 0 ? (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">Enter the password again to confirm it.</p>
              ) : null}
            </div>

            {errorMsg && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{errorMsg}</p>}

            <button
              type="submit"
              className="w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
              disabled={busy}
            >
              {busy ? "Setting password…" : "Set Password"}
            </button>
          </div>
        </form>
      )}

      {phase === "needs-signin" && (
        <Notice icon="🔒" tone="info" title="Sign in to accept" action={<Link href="/login" className={primary}>Sign in</Link>}>
          {invite?.email ? (
            <>
              <strong className="break-all">{invite.email}</strong> already has an account. Sign in and accept the invitation
              from there.
            </>
          ) : (
            "Sign in to accept this invitation."
          )}
        </Notice>
      )}

      {phase === "already-accepted" && (
        <Notice icon="✓" tone="ok" title="This link has already been used" action={<Link href="/login" className={primary}>Sign in</Link>}>
          {invite ? (
            <>
              The password for <strong className="break-all">{invite.email}</strong> is already set. Sign in to continue.
            </>
          ) : (
            "The password for this account is already set. Sign in to continue."
          )}
        </Notice>
      )}

      {phase === "done" && (
        <Notice icon="✓" tone="ok" title="Your password is set" action={<Link href="/login" className={primary}>Continue to sign in</Link>}>
          {invite ? <>Sign in as <strong className="break-all">{invite.email}</strong>. Taking you there now…</> : "Taking you to sign in…"}
        </Notice>
      )}

      {phase === "expired" && (
        <Notice icon="⌛" tone="warn" title="This link has expired" action={<Link href="/login" className={secondary}>Back to sign in</Link>}>
          Setup links stop working after a while, for your security. Ask the administrator who sent it to generate a new link.
        </Notice>
      )}

      {phase === "invalid" && (
        <Notice icon="✗" tone="crit" title="This link is no longer valid" action={<Link href="/login" className={secondary}>Back to sign in</Link>}>
          It may have been replaced by a newer link or withdrawn. Use the most recent link you were sent, or ask your
          administrator for a new one.
        </Notice>
      )}

      {phase === "error" && (
        <Notice icon="!" tone="crit" title="Something went wrong" action={<Link href="/login" className={secondary}>Back to sign in</Link>}>
          {errorMsg || "We could not check this link. Try again in a moment."}
        </Notice>
      )}

      {phase === "no-token" && (
        <Notice icon="✗" tone="crit" title="Invalid link" action={<Link href="/login" className={secondary}>Back to sign in</Link>}>
          This link is incomplete. Copy the whole link you were sent and try again.
        </Notice>
      )}
    </div>
  );
}

export function AcceptInvitationScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
      <Suspense>
        <AcceptInvitationInner />
      </Suspense>
    </div>
  );
}
