"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ApiError, newIdempotencyKey } from "@/lib/api-client";
import {
  describeInvitation,
  describeProvisioningError,
  emailProblem,
  formatQuota,
  localPartProblem,
  STATUS_LABEL,
  STATUS_TONE,
  type ProvisionedMailbox,
  type ProvisionMailboxInput,
} from "@/lib/mailbox-provisioning-api";
import {
  useProvisionMailbox,
  useProvisioningOptions,
  useResendMailboxInvitation,
  useRetryMailboxProvisioning,
} from "@/lib/mailbox-provisioning-hooks";

/**
 * Create Email — form, review, result.
 *
 * One component for both the Owner and Admin dashboards; each page only says
 * where its Domains screen lives. The server is the authority on everything
 * here: which domains are usable, which quotas the plan allows, whether the
 * mail server is configured. This screen reflects those answers and never
 * claims a mailbox exists until the server says the mail server confirmed it.
 */

type Step = "form" | "review" | "result";

interface Draft {
  domainId: string;
  localPart: string;
  displayName: string;
  quotaBytes: number | null;
  recoveryEmail: string;
}

const EMPTY: Draft = { domainId: "", localPart: "", displayName: "", quotaBytes: null, recoveryEmail: "" };

const label = "font-mono-num mb-1 block text-[9.5px] uppercase tracking-[0.1em] text-[var(--ink3)]";
const field =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--s2)] px-3 py-2 text-[12.6px] text-[var(--ink)] placeholder:text-[var(--ink3)] disabled:opacity-60";
const hint = "mt-1 text-[11.5px] text-[var(--ink3)]";
const problemText = "mt-1 text-[11.5px] text-[var(--crit)]";

function Callout({ tone, children }: { tone: "info" | "warn" | "crit" | "ok"; children: React.ReactNode }) {
  const tones = {
    info: "bg-[var(--ai-soft)] border-[var(--ai)]",
    ok: "bg-[var(--ok-soft)] border-[var(--ok)]",
    warn: "bg-[var(--warn-soft)] border-[var(--warn)]",
    crit: "bg-[var(--crit-soft)] border-[var(--crit)]",
  } as const;
  return (
    <div role={tone === "crit" ? "alert" : undefined} className={`rounded-[10px] border px-3 py-2.5 text-[12px] leading-relaxed text-[var(--ink2)] ${tones[tone]}`}>
      {children}
    </div>
  );
}

function ReviewRow({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-[var(--border)] py-2 last:border-b-0 sm:flex-row sm:gap-4">
      <dt className="font-mono-num w-40 shrink-0 text-[10px] uppercase tracking-[0.08em] text-[var(--ink3)]">{term}</dt>
      <dd className="min-w-0 break-words text-[12.6px] text-[var(--ink)]">{children}</dd>
    </div>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-1.5 text-[12px]">
      <span aria-hidden className={ok ? "text-[var(--ok)]" : "text-[var(--warn)]"}>{ok ? "✓" : "!"}</span>
      <span className="text-[var(--ink2)]">{children}</span>
    </li>
  );
}

export function CreateEmailWizard({ onClose, domainsHref }: { onClose: () => void; domainsHref: string }) {
  const options = useProvisioningOptions();
  const provision = useProvisionMailbox();
  const retry = useRetryMailboxProvisioning();
  const resend = useResendMailboxInvitation();

  const [step, setStep] = useState<Step>("form");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [touched, setTouched] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [result, setResult] = useState<ProvisionedMailbox | null>(null);
  const [submitError, setSubmitError] = useState<ApiError | Error | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const data = options.data;
  const usable = useMemo(() => (data?.domains ?? []).filter((d) => d.usable), [data]);
  const unverified = useMemo(() => (data?.domains ?? []).filter((d) => !d.usable), [data]);
  const domain = usable.find((d) => d.id === draft.domainId) ?? null;

  // Sensible starting values once the server has said what is allowed.
  useEffect(() => {
    if (!data) return;
    setDraft((current) => ({
      ...current,
      domainId: current.domainId || (usable.length === 1 ? usable[0]!.id : ""),
      quotaBytes: current.quotaBytes ?? data.quota.defaultBytes,
    }));
  }, [data, usable]);

  const local = draft.localPart.trim().toLowerCase();
  const address = domain && local ? `${local}@${domain.domainName}` : null;

  const problems = {
    domainId: draft.domainId ? null : "Choose a verified domain.",
    localPart: localPartProblem(draft.localPart),
    displayName: draft.displayName.trim() ? (draft.displayName.trim().length > 120 ? "Keep it to 120 characters." : null) : "Enter the name shown beside the address.",
    quotaBytes: draft.quotaBytes ? null : "Choose a quota.",
    recoveryEmail:
      emailProblem(draft.recoveryEmail) ??
      (address && draft.recoveryEmail.trim().toLowerCase() === address
        ? "Send the invitation to an address they can already read, not the new mailbox."
        : null),
  };
  const valid = Object.values(problems).every((p) => p === null);

  const atLimit = data ? data.mailboxes.limit !== null && data.mailboxes.used >= data.mailboxes.limit : false;
  const blocked = !data || !data.providerConfigured || usable.length === 0 || atLimit;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const toReview = () => {
    setTouched(true);
    if (!valid || blocked) return;
    // One key per confirmation. A double click or a retried request then
    // replays the same answer; editing the form starts a new operation.
    setIdempotencyKey(newIdempotencyKey());
    setSubmitError(null);
    setStep("review");
  };

  const confirm = async () => {
    if (!domain || !draft.quotaBytes) return;
    const input: ProvisionMailboxInput = {
      domainId: domain.id,
      localPart: local,
      displayName: draft.displayName.trim(),
      quotaBytes: draft.quotaBytes,
      initialAccess: "INVITE",
      recoveryEmail: draft.recoveryEmail.trim().toLowerCase(),
    };
    setSubmitError(null);
    try {
      const created = await provision.mutateAsync({ input, idempotencyKey });
      setResult(created);
      setStep("result");
    } catch (error) {
      setSubmitError(error as Error);
    }
  };

  const runAction = async (kind: "retry" | "resend") => {
    if (!result) return;
    setActionError(null);
    try {
      setResult(kind === "retry" ? await retry.mutateAsync(result.id) : await resend.mutateAsync(result.id));
    } catch (error) {
      setActionError((error as Error).message);
    }
  };

  const reset = () => {
    setDraft({ ...EMPTY, domainId: usable.length === 1 ? usable[0]!.id : "", quotaBytes: data?.quota.defaultBytes ?? null });
    setTouched(false);
    setResult(null);
    setSubmitError(null);
    setActionError(null);
    setStep("form");
  };

  const busy = provision.isPending || retry.isPending || resend.isPending;
  const title = step === "form" ? "Create email" : step === "review" ? "Review & create" : "Create email";

  /* ── footer per step ────────────────────────────────────────────────── */
  const footer =
    step === "form" ? (
      <>
        <button type="button" className="zoiko-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="zoiko-btn pri" disabled={blocked} onClick={toReview}>
          Review
        </button>
      </>
    ) : step === "review" ? (
      <>
        <button type="button" className="zoiko-btn" disabled={provision.isPending} onClick={() => setStep("form")}>
          Back to edit
        </button>
        <button type="button" className="zoiko-btn pri" disabled={provision.isPending} onClick={() => void confirm()}>
          {provision.isPending ? "Creating…" : "Confirm & create"}
        </button>
      </>
    ) : (
      <>
        <button type="button" className="zoiko-btn" disabled={busy} onClick={reset}>Create another</button>
        <button type="button" className="zoiko-btn pri" onClick={onClose}>Done</button>
      </>
    );

  return (
    <Modal open onClose={busy ? () => undefined : onClose} title={title} size="md" footer={footer}>
      <ol className="mb-4 flex gap-2 text-[10.5px] font-mono-num uppercase tracking-[0.08em]" aria-label="Steps">
        {(["form", "review", "result"] as const).map((s, i) => (
          <li
            key={s}
            aria-current={step === s ? "step" : undefined}
            className={step === s ? "text-[var(--accent)]" : "text-[var(--ink3)]"}
          >
            {i + 1}. {s === "form" ? "Details" : s === "review" ? "Review" : "Result"}
          </li>
        ))}
      </ol>

      {options.isLoading ? (
        <p className="text-[12.5px] text-[var(--ink3)]">Loading domains and quotas…</p>
      ) : options.error ? (
        <Callout tone="crit">Could not load what this workspace can create. {(options.error as Error).message}</Callout>
      ) : step === "form" ? (
        renderForm()
      ) : step === "review" ? (
        renderReview()
      ) : (
        renderResult()
      )}
    </Modal>
  );

  /* ── steps ──────────────────────────────────────────────────────────── */

  function renderForm() {
    if (!data) return null;
    const show = (key: keyof typeof problems) => (touched ? problems[key] : null);
    return (
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          toReview();
        }}
      >
        {!data.providerConfigured && (
          <Callout tone="crit">
            Mailbox hosting is not configured on this deployment, so new email addresses cannot be
            created yet. An operator needs to connect the mail server first.
          </Callout>
        )}
        {atLimit && (
          <Callout tone="warn">
            This workspace has reached its plan&apos;s mailbox limit ({data.mailboxes.used}/{data.mailboxes.limit}).
            Upgrade the plan to create more.
          </Callout>
        )}
        {usable.length === 0 && (
          <Callout tone="warn">
            No domain has passed verification yet.{" "}
            <Link href={domainsHref} className="font-semibold text-[var(--accent)] underline">
              Verify a domain
            </Link>{" "}
            to create addresses on it.
          </Callout>
        )}

        <div>
          <label htmlFor="ce-domain" className={label}>Domain</label>
          <select
            id="ce-domain"
            className={field}
            value={draft.domainId}
            disabled={usable.length === 0}
            onChange={(e) => set("domainId", e.target.value)}
            aria-invalid={Boolean(show("domainId"))}
          >
            <option value="">Choose a verified domain…</option>
            {usable.map((d) => (
              <option key={d.id} value={d.id}>{d.domainName}</option>
            ))}
            {unverified.map((d) => (
              <option key={d.id} value={d.id} disabled>
                {d.domainName} (not verified)
              </option>
            ))}
          </select>
          {show("domainId") && <p className={problemText}>{show("domainId")}</p>}
        </div>

        <div>
          <label htmlFor="ce-local" className={label}>Username</label>
          <div className="flex items-stretch overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--s2)]">
            <input
              id="ce-local"
              className="min-w-0 flex-1 bg-transparent px-3 py-2 text-[12.6px] text-[var(--ink)] placeholder:text-[var(--ink3)] focus:outline-none"
              placeholder="john"
              autoComplete="off"
              spellCheck={false}
              value={draft.localPart}
              onChange={(e) => set("localPart", e.target.value)}
              aria-invalid={Boolean(show("localPart"))}
              aria-describedby="ce-address"
            />
            <span className="flex max-w-[55%] items-center truncate border-l border-[var(--border)] px-3 text-[12.6px] text-[var(--ink3)]">
              @{domain?.domainName ?? "domain"}
            </span>
          </div>
          {show("localPart") && <p className={problemText}>{show("localPart")}</p>}
          <p id="ce-address" className="mt-1.5 text-[12px] text-[var(--ink2)]">
            Email address:{" "}
            <span data-testid="ce-address-preview" className="font-mono-num font-semibold text-[var(--ink)]">
              {address ?? "—"}
            </span>
          </p>
        </div>

        <div>
          <label htmlFor="ce-name" className={label}>Display name</label>
          <input
            id="ce-name"
            className={field}
            placeholder="Support Team"
            value={draft.displayName}
            onChange={(e) => set("displayName", e.target.value)}
            aria-invalid={Boolean(show("displayName"))}
          />
          {show("displayName") && <p className={problemText}>{show("displayName")}</p>}
        </div>

        <div>
          <label htmlFor="ce-quota" className={label}>Mailbox quota</label>
          <select
            id="ce-quota"
            className={field}
            value={draft.quotaBytes ?? ""}
            onChange={(e) => set("quotaBytes", e.target.value ? Number(e.target.value) : null)}
          >
            {data.quota.optionsBytes.map((bytes) => (
              <option key={bytes} value={bytes}>{formatQuota(bytes)}</option>
            ))}
          </select>
          {data.quota.maxBytes !== null && (
            <p className={hint}>Your plan allows up to {formatQuota(data.quota.maxBytes)} per mailbox.</p>
          )}
        </div>

        <fieldset>
          <legend className={label}>Initial access</legend>
          <label className="flex items-start gap-2 text-[12.4px] text-[var(--ink)]">
            <input type="radio" checked readOnly className="mt-0.5" />
            <span>
              Secure invitation
              <span className="block text-[11.5px] text-[var(--ink3)]">
                The person sets their own password from a single-use, expiring link. No password is ever emailed.
              </span>
            </span>
          </label>
        </fieldset>

        <div>
          <label htmlFor="ce-recovery" className={label}>Send invitation to</label>
          <input
            id="ce-recovery"
            type="email"
            className={field}
            placeholder="their existing address, e.g. john@gmail.com"
            value={draft.recoveryEmail}
            onChange={(e) => set("recoveryEmail", e.target.value)}
            aria-invalid={Boolean(show("recoveryEmail"))}
          />
          {show("recoveryEmail") ? (
            <p className={problemText}>{show("recoveryEmail")}</p>
          ) : (
            <p className={hint}>
              An address they can read today. If it belongs to someone already in this workspace, the
              mailbox is added to their account instead.
            </p>
          )}
        </div>
        {/* Enter submits from any field. */}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    );
  }

  function renderReview() {
    if (!domain || !data) return null;
    const r = domain.readiness;
    const errorCode = submitError instanceof ApiError ? submitError.code : undefined;
    return (
      <div className="flex flex-col gap-4">
        <dl>
          <ReviewRow term="Email address">
            <span className="font-mono-num font-semibold" data-testid="review-address">{address}</span>
          </ReviewRow>
          <ReviewRow term="Display name">{draft.displayName.trim()}</ReviewRow>
          <ReviewRow term="Domain">
            {domain.domainName}{" "}
            <StatusBadge variant={r.ownershipVerified ? "ok" : "warn"}>
              {r.ownershipVerified ? "Verified" : "Not verified"}
            </StatusBadge>
          </ReviewRow>
          <ReviewRow term="Quota">{formatQuota(draft.quotaBytes)}</ReviewRow>
          <ReviewRow term="Initial access">Secure invitation</ReviewRow>
          <ReviewRow term="Invitation to">{draft.recoveryEmail.trim().toLowerCase()}</ReviewRow>
        </dl>

        <div>
          <p className={label}>Domain readiness</p>
          <ul className="flex flex-col gap-1">
            <Check ok={r.ownershipVerified}>Domain ownership verified</Check>
            <Check ok={r.inboundRouting}>
              {r.inboundRouting ? "MX records point at the platform" : "MX records are not confirmed yet — mail sent to this address may not arrive"}
            </Check>
            <Check ok={r.outboundConfigured}>
              {r.outboundConfigured ? "SPF and DKIM verified and sending enabled" : "Sending is not ready yet (SPF/DKIM or sending activation pending on the Domains screen)"}
            </Check>
            <Check ok={r.dmarcPublished}>{r.dmarcPublished ? "DMARC published" : "No valid DMARC record yet"}</Check>
          </ul>
        </div>

        {data.invitationDelivery === "DISABLED" && (
          <Callout tone="warn">
            Email delivery is turned off on this deployment, so the invitation will be recorded but not sent.
          </Callout>
        )}

        {provision.isPending && (
          <Callout tone="info">Creating the mailbox on the mail server… This can take a few seconds.</Callout>
        )}
        {submitError && (
          <Callout tone="crit">
            <b className="text-[var(--crit)]">Not created.</b> {submitError.message}
            {(errorCode === "CONFLICT" || errorCode === "VALIDATION_ERROR") && " Go back to edit and change it."}
          </Callout>
        )}
        <p className={hint}>Nothing is created until you confirm.</p>
      </div>
    );
  }

  function renderResult() {
    if (!result) return null;
    const provisioned = result.provisioningStatus === "PROVISIONED";
    const canResend =
      provisioned &&
      result.membershipStatus === "INVITED" &&
      (result.invitationStatus === "FAILED" || result.invitationStatus === "PENDING" || result.invitationStatus === "SENT");
    return (
      <div className="flex flex-col gap-4" aria-live="polite">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono-num text-[13px] font-semibold text-[var(--ink)]">{result.address}</span>
          <StatusBadge variant={STATUS_TONE[result.status]} dot>
            {STATUS_LABEL[result.status]}
          </StatusBadge>
        </div>

        <section>
          <p className={label}>Mailbox</p>
          {provisioned ? (
            <Callout tone="ok">
              Mailbox created on the mail server with a {formatQuota(result.appliedQuotaBytes ?? result.quotaBytes)} quota.
            </Callout>
          ) : result.provisioningStatus === "FAILED" ? (
            <Callout tone="crit">
              <b className="text-[var(--crit)]">Provisioning failed.</b> {describeProvisioningError(result.provisioningError)}
            </Callout>
          ) : (
            <Callout tone="info">Provisioning is still in progress. Check the mailbox list shortly.</Callout>
          )}
          {!provisioned && (
            <button type="button" className="zoiko-btn sm mt-2" disabled={busy} onClick={() => void runAction("retry")}>
              {retry.isPending ? "Retrying…" : "Retry provisioning"}
            </button>
          )}
        </section>

        <section>
          <p className={label}>Invitation</p>
          <p className="text-[12.4px] text-[var(--ink2)]" data-testid="invitation-status">
            {describeInvitation(result.invitationStatus, result.invitationError, result.invitationRecipient)}
          </p>
          {canResend && (
            <button type="button" className="zoiko-btn sm mt-2" disabled={busy} onClick={() => void runAction("resend")}>
              {resend.isPending ? "Sending…" : result.invitationStatus === "SENT" ? "Resend invitation" : "Send invitation"}
            </button>
          )}
        </section>

        {actionError && <Callout tone="crit">{actionError}</Callout>}
      </div>
    );
  }
}
