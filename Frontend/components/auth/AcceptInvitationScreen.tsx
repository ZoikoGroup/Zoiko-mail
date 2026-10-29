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
import { BrandLoader } from "@/components/ui/BrandLoader";

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
  // Read once and held in memory. The token is then taken out of the address
  // bar (below), so it is not left in browser history or shown on screen.
  const [token] = useState(() => params.get("token") ?? "");

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
    if (!token) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("token")) {
      url.searchParams.delete("token");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
  }, [token]);

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
            window.location.href = found.role === "MEMBER" ? "/login/member" : "/login";
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

  // Members sign in on the Member page (/login/member); everyone else, and
  // anyone whose invitation could not be read, on the main sign-in page.
  const signInHref = invite?.role === "MEMBER" ? "/login/member" : "/login";

  useEffect(() => {
    if (phase !== "done") return;
    // To sign in, with the password they just chose: it proves the password
    // works before they depend on it, and MFA enrolment lives on that path.
    const timer = window.setTimeout(() => router.push(signInHref), REDIRECT_MS);
    return () => window.clearTimeout(timer);
  }, [phase, router, signInHref]);

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

  // Nothing to show until the server has answered, so the whole screen waits
  // on the loader, carrying on from the Suspense fallback below.
  if (phase === "loading" || phase === "accepting") {
    return <BrandLoader label={phase === "accepting" ? "Accepting your invitation" : "Checking your invitation"} />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
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
          <Notice icon="🔒" tone="info" title="Sign in to accept" action={<Link href={signInHref} className={primary}>Sign in</Link>}>
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
          <Notice icon="✓" tone="ok" title="This link has already been used" action={<Link href={signInHref} className={primary}>Sign in</Link>}>
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
          <Notice icon="✓" tone="ok" title="Your password is set" action={<Link href={signInHref} className={primary}>Continue to sign in</Link>}>
            {invite ? <>Sign in as <strong className="break-all">{invite.email}</strong>. Taking you there now…</> : "Taking you to sign in…"}
          </Notice>
        )}

        {phase === "expired" && (
          <Notice icon="⌛" tone="warn" title="This link has expired" action={<Link href={signInHref} className={secondary}>Back to sign in</Link>}>
            Setup links stop working after a while, for your security. Ask the administrator who sent it to generate a new link.
          </Notice>
        )}

        {phase === "invalid" && (
          <Notice icon="✗" tone="crit" title="This link is no longer valid" action={<Link href={signInHref} className={secondary}>Back to sign in</Link>}>
            It may have been replaced by a newer link or withdrawn. Use the most recent link you were sent, or ask your
            administrator for a new one.
          </Notice>
        )}

        {phase === "error" && (
          <Notice icon="!" tone="crit" title="Something went wrong" action={<Link href={signInHref} className={secondary}>Back to sign in</Link>}>
            {errorMsg || "We could not check this link. Try again in a moment."}
          </Notice>
        )}

        {phase === "no-token" && (
          <Notice icon="✗" tone="crit" title="Invalid link" action={<Link href={signInHref} className={secondary}>Back to sign in</Link>}>
            This link is incomplete. Open the whole link you were sent again — if you reloaded this page, that is
            why: the link is only read once, for your security.
          </Notice>
        )}
      </div>
    </div>
  );
}

export function AcceptInvitationScreen() {
  // useSearchParams() suspends during static rendering, so the fallback is
  // what the server sends: the full-screen loader the lookup then continues.
  // The page frame lives inside, so the loader can fill the viewport.
  return (
    <Suspense fallback={<BrandLoader label="Checking your invitation" />}>
      <AcceptInvitationInner />
    </Suspense>
  );
}
