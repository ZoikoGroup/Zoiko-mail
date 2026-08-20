"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { StepIndicator } from "@/components/ui/StepIndicator";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  useOnboardingStatus,
  useAddDomain,
  useDomains,
  useRunDiagnostics,
  useActivateDomain,
  useCreateAdminMailbox,
  useMembers,
  useAdminMailboxes,
  useInviteMember,
} from "@/lib/owner-hooks";
import type { OnboardingSteps } from "@/lib/owner-api";
import {
  CheckCircle2,
  Building2,
  Globe,
  Mail,
  Link2,
  Users,
  ArrowRight,
  ArrowLeft,
  Rocket,
  RefreshCw,
  AlertCircle,
  UserPlus,
} from "lucide-react";

interface StepDef {
  key: keyof OnboardingSteps;
  label: string;
  description: string;
  icon: typeof Building2;
  skippable: boolean;
}

const STEPS: StepDef[] = [
  {
    key: "workspaceCreated",
    label: "Workspace",
    description: "Your workspace is ready.",
    icon: Building2,
    skippable: false,
  },
  {
    key: "domainAdded",
    label: "Add Domain",
    description: "Add a custom domain for sending.",
    icon: Globe,
    skippable: true,
  },
  {
    key: "domainVerified",
    label: "Verify Domain",
    description: "Verify DNS records for your domain.",
    icon: Globe,
    skippable: true,
  },
  {
    key: "mailboxCreated",
    label: "Create Mailbox",
    description: "Create your first mailbox.",
    icon: Mail,
    skippable: true,
  },
  {
    key: "providerConnected",
    label: "Connect Provider",
    description: "Connect Gmail or Microsoft 365.",
    icon: Link2,
    skippable: true,
  },
  {
    key: "teamInvited",
    label: "Invite Team",
    description: "Invite team members to collaborate.",
    icon: Users,
    skippable: true,
  },
];

export function OnboardingWizard() {
  const { data: status, isLoading, refetch } = useOnboardingStatus();
  const [currentStep, setCurrentStep] = useState(0);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:px-6">
        <div className="space-y-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-1 w-full" />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="zoiko-card p-6">
              <div className="flex items-center gap-4">
                <Skeleton variant="circle" className="h-12 w-12" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-3 w-64" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!status) return null;

  if (status.isComplete) {
    return (
      <div className="mx-auto max-w-lg space-y-6 px-4 py-16 text-center sm:px-6">
        <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-[var(--ok-soft)]">
          <Rocket className="h-8 w-8 text-[var(--ok)]" />
        </span>
        <h1 className="font-editorial text-2xl font-semibold text-[var(--ink)]">
          You&apos;re all set!
        </h1>
        <p className="text-sm text-[var(--ink3)]">
          Your workspace is fully configured. Explore your dashboard to get started.
        </p>
        <Link href="/owner" className="zoiko-btn pri inline-flex">
          Go to Dashboard <ArrowRight className="ml-1 h-3.5 w-3.5" />
        </Link>
      </div>
    );
  }

  const activeStepIdx = STEPS.findIndex((s) => !status.steps[s.key]);
  const effectiveStep = activeStepIdx >= 0 ? activeStepIdx : currentStep;
  const step = STEPS[effectiveStep];
  const StepIcon = step.icon;

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <h1 className="font-editorial text-2xl font-semibold tracking-tight text-[var(--ink)]">
          Welcome to Zoiko Mail
        </h1>
        <p className="mt-1 text-sm text-[var(--ink3)]">
          Complete these steps to get your workspace up and running.
          You can skip steps and come back later.
        </p>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-[var(--ink)]">Setup Progress</span>
          <StatusBadge variant={status.completedCount === status.totalSteps ? "ok" : "accent"}>
            {status.completedCount}/{status.totalSteps} complete
          </StatusBadge>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {STEPS.map((s, i) => (
            <button
              key={s.key}
              onClick={() => setCurrentStep(i)}
              className={`flex flex-col items-center rounded-lg border p-2 text-center transition ${
                i === effectiveStep
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : status.steps[s.key]
                  ? "border-[var(--ok)] bg-[var(--ok-soft)]"
                  : "border-[var(--border)] bg-[var(--s2)]"
              }`}
            >
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${
                  status.steps[s.key]
                    ? "bg-[var(--ok)] text-white"
                    : i === effectiveStep
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--s3)] text-[var(--ink3)]"
                }`}
              >
                {status.steps[s.key] ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="mt-1 text-[10px] font-medium text-[var(--ink2)]">{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="zoiko-card p-6">
        <div className="flex items-start gap-4">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-ink)]">
            <StepIcon className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-[var(--ink)]">
                Step {effectiveStep + 1}: {step.label}
              </h2>
              {status.steps[step.key] && <StatusBadge variant="ok" dot>Done</StatusBadge>}
            </div>
            <p className="mt-1 text-sm text-[var(--ink3)]">{step.description}</p>
          </div>
        </div>

        <div className="mt-5">
          {step.key === "workspaceCreated" && (
            <WorkspaceStep
              onContinue={() => setCurrentStep(effectiveStep + 1)}
              isLast={effectiveStep === STEPS.length - 1}
            />
          )}
          {step.key === "domainAdded" && (
            <AddDomainStep onComplete={() => refetch()} />
          )}
          {step.key === "domainVerified" && (
            <VerifyDomainStep onComplete={() => refetch()} />
          )}
          {step.key === "mailboxCreated" && (
            <CreateMailboxStep onComplete={() => refetch()} />
          )}
          {step.key === "providerConnected" && (
            <ConnectProviderStep />
          )}
          {step.key === "teamInvited" && (
            <InviteTeamStep onComplete={() => refetch()} />
          )}
        </div>

        <div className="mt-6 flex items-center gap-3 border-t border-[var(--border)] pt-4">
          {step.skippable && !status.steps[step.key] && (
            <Link href="/owner" className="zoiko-btn">
              Skip for now
            </Link>
          )}
          {effectiveStep > 0 && (
            <button onClick={() => setCurrentStep(effectiveStep - 1)} className="zoiko-btn">
              <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Previous
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--s2)] p-4">
        <p className="text-sm text-[var(--ink3)]">
          Need help? Check out our{" "}
          <a href="https://docs.zoiko.dev" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">
            documentation
          </a>{" "}
          or{" "}
          <a href="mailto:support@zoiko.dev" className="text-[var(--accent)] hover:underline">
            contact support
          </a>.
        </p>
      </div>
    </div>
  );
}

function WorkspaceStep({ onContinue, isLast }: { onContinue: () => void; isLast: boolean }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-[var(--ok-soft)] p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-[var(--ok)]">
          <CheckCircle2 className="h-4 w-4" />
          Workspace created successfully
        </div>
        <p className="mt-1 text-sm text-[var(--ink3)]">
          Your workspace is active and ready. You can configure the name in Organization Settings.
        </p>
      </div>
      <button onClick={onContinue} className="zoiko-btn pri">
        {isLast ? (
          <>Go to Dashboard <Rocket className="ml-1 h-3.5 w-3.5" /></>
        ) : (
          <>Next Step <ArrowRight className="ml-1 h-3.5 w-3.5" /></>
        )}
      </button>
    </div>
  );
}

function AddDomainStep({ onComplete }: { onComplete: () => void }) {
  const [domain, setDomain] = useState("");
  const addDomain = useAddDomain();
  const { refetch } = useOnboardingStatus();

  const handleSubmit = () => {
    if (!domain.trim()) return;
    addDomain.mutate(
      { domain: domain.trim() },
      {
        onSuccess: () => {
          setDomain("");
          onComplete();
          refetch();
        },
      }
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Domain Name</label>
        <input
          type="text"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="yourdomain.com"
          className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        />
      </div>
      <button
        onClick={handleSubmit}
        className="zoiko-btn pri"
        disabled={!domain.trim() || addDomain.isPending}
      >
        <Globe className="h-3.5 w-3.5" />
        {addDomain.isPending ? "Adding…" : "Add Domain"}
      </button>
      {addDomain.isError && (
        <p className="text-[11px] text-[var(--crit)]">Failed to add domain. Please try again.</p>
      )}
    </div>
  );
}

function VerifyDomainStep({ onComplete }: { onComplete: () => void }) {
  const { data: domains = [] } = useDomains();
  const runDiagnostics = useRunDiagnostics();
  const activateDomain = useActivateDomain();
  const { refetch } = useOnboardingStatus();

  const unverifiedDomain = domains.find(
    (d) => d.verificationStatus !== "VERIFIED"
  );
  const verifiedButInactive = domains.find(
    (d) => d.verificationStatus === "VERIFIED" && !d.isActive
  );

  if (domains.length === 0) {
    return (
      <div className="rounded-lg bg-[var(--s2)] p-4 text-center text-sm text-[var(--ink3)]">
        No domains added yet. Go back and add a domain first.
      </div>
    );
  }

  if (verifiedButInactive) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg bg-[var(--ok-soft)] p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--ok)]">
            <CheckCircle2 className="h-4 w-4" />
            DNS verification passed for {verifiedButInactive.domain}
          </div>
          <p className="mt-1 text-sm text-[var(--ink3)]">
            All DNS records are verified. Activate the domain to start sending.
          </p>
        </div>
        <button
          onClick={() => {
            activateDomain.mutate(verifiedButInactive.id, {
              onSuccess: () => {
                onComplete();
                refetch();
              },
            });
          }}
          className="zoiko-btn pri"
          disabled={activateDomain.isPending}
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {activateDomain.isPending ? "Activating…" : "Activate Domain"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--s2)] p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
          <AlertCircle className="h-4 w-4 text-[var(--warn)]" />
          DNS Configuration Required
        </div>
        <p className="mt-2 text-sm text-[var(--ink3)]">
          Add the following DNS records to your domain provider. Changes may take up to 48 hours to propagate.
        </p>
        <div className="mt-3 rounded-md bg-[var(--surface)] p-3 font-mono text-xs text-[var(--ink2)] space-y-1">
          <div>MX: mail.zoiko.dev (priority 10)</div>
          <div>SPF: v=spf1 include:zoiko.dev ~all</div>
          <div>DKIM: selector._domainkey.zoiko.dev</div>
          <div>DMARC: _dmarc.zoiko.dev — v=DMARC1; p=quarantine</div>
        </div>
      </div>
      {unverifiedDomain && (
        <button
          onClick={() => {
            runDiagnostics.mutate(unverifiedDomain.id, {
              onSuccess: () => {
                onComplete();
                refetch();
              },
            });
          }}
          className="zoiko-btn pri"
          disabled={runDiagnostics.isPending}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${runDiagnostics.isPending ? "animate-spin" : ""}`} />
          {runDiagnostics.isPending ? "Checking DNS…" : "Run DNS Check"}
        </button>
      )}
      {runDiagnostics.isError && (
        <p className="text-[11px] text-[var(--crit)]">DNS check failed. Make sure records are configured and try again.</p>
      )}
    </div>
  );
}

function CreateMailboxStep({ onComplete }: { onComplete: () => void }) {
  const { data: members = [] } = useMembers();
  const { data: mailboxes = [] } = useAdminMailboxes();
  const createMailbox = useCreateAdminMailbox();
  const [selectedId, setSelectedId] = useState("");
  const { refetch } = useOnboardingStatus();

  const membersWithoutMailbox = members.filter(
    (m) => m.status === "ACTIVE" && !mailboxes.some((mb) => mb.userId === m.userId)
  );

  const handleCreate = () => {
    if (!selectedId) return;
    createMailbox.mutate(selectedId, {
      onSuccess: () => {
        setSelectedId("");
        onComplete();
        refetch();
      },
    });
  };

  if (membersWithoutMailbox.length === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg bg-[var(--ok-soft)] p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--ok)]">
            <CheckCircle2 className="h-4 w-4" />
            All active members have mailboxes
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Select Member</label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        >
          <option value="">Choose a member…</option>
          {membersWithoutMailbox.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName} ({m.email})
            </option>
          ))}
        </select>
      </div>
      {selectedId && (
        <div className="rounded-lg bg-[var(--s2)] p-3 text-[11px] text-[var(--ink3)]">
          <strong className="text-[var(--ink2)]">Mailbox address:</strong>{" "}
          {membersWithoutMailbox.find((m) => m.id === selectedId)?.email}
        </div>
      )}
      <button
        onClick={handleCreate}
        className="zoiko-btn pri"
        disabled={!selectedId || createMailbox.isPending}
      >
        <Mail className="h-3.5 w-3.5" />
        {createMailbox.isPending ? "Creating…" : "Create Mailbox"}
      </button>
      {createMailbox.isError && (
        <p className="text-[11px] text-[var(--crit)]">Failed to create mailbox. Please try again.</p>
      )}
    </div>
  );
}

function ConnectProviderStep() {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--s2)] p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
          <Link2 className="h-4 w-4 text-[var(--accent-ink)]" />
          Connect via OAuth
        </div>
        <p className="mt-2 text-sm text-[var(--ink3)]">
          Connect Gmail or Microsoft 365 to enable mail sync. Users can also connect their own accounts from the Connected Accounts page.
        </p>
      </div>
      <Link href="/connected-accounts" className="zoiko-btn pri">
        <Link2 className="h-3.5 w-3.5" />
        Go to Connected Accounts
        <ArrowRight className="ml-1 h-3.5 w-3.5" />
      </Link>
      <p className="text-[11px] text-[var(--ink3)]">
        Provider connection requires OAuth redirect. You can complete this later.
      </p>
    </div>
  );
}

function InviteTeamStep({ onComplete }: { onComplete: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
  const inviteMember = useInviteMember();
  const { refetch } = useOnboardingStatus();

  const handleInvite = () => {
    if (!email.trim()) return;
    inviteMember.mutate(
      { email: email.trim(), role },
      {
        onSuccess: () => {
          setEmail("");
          setRole("MEMBER");
          onComplete();
          refetch();
        },
      }
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Email Address</label>
        <div className="relative">
          <UserPlus className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink3)]" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@company.com"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            onKeyDown={(e) => e.key === "Enter" && handleInvite()}
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-[var(--ink2)]">Role</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "ADMIN" | "MEMBER")}
          className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        >
          <option value="MEMBER">Member — Basic access</option>
          <option value="ADMIN">Admin — Full management access</option>
        </select>
      </div>
      <p className="text-[11px] text-[var(--ink3)]">
        An invitation email will be sent. The user will be able to accept and join your organization.
      </p>
      <button
        onClick={handleInvite}
        className="zoiko-btn pri"
        disabled={!email.trim() || inviteMember.isPending}
      >
        <UserPlus className="h-3.5 w-3.5" />
        {inviteMember.isPending ? "Sending…" : "Send Invitation"}
      </button>
      {inviteMember.isError && (
        <p className="text-[11px] text-[var(--crit)]">Failed to send invitation. Please try again.</p>
      )}
    </div>
  );
}


