# Known issues register

**Owner:** Support Lead · **Gate:** Friendly Pilot (Runbook §9)

What support tells a customer before the customer tells us. Every entry needs
a customer-facing line, because §11 requires customer communication to be
consistent — support and the status page must not describe the same fault
differently.

## Open

| # | Issue | Severity | Customer-facing line | Workaround | Owner | Raised |
|---|---|---|---|---|---|---|
| KI-001 | External recipients stay `QUEUED` after a successful SMTP send; only a provider webhook advances them. Internal delivery is unaffected. | P2 | "Delivery status for external recipients may show as queued after the message has been sent. The message itself is delivered." | Confirm delivery from `Delivery events` rather than the recipient row | `TODO(eng)` | 2026-09-18 |
| KI-002 | AI cannot send external mail autonomously (AC-009) is true in practice but has no automated assertion. | P1 | *(internal only — not customer-facing)* | Manual review before external pilot | `TODO(eng)` | 2026-09-18 |
| KI-003 | MFA enforcement is behind `FLAG_MFA_ENFORCEMENT_ENABLED`; no test covers the disabled path. AC-002 states it unconditionally. | P1 | *(internal only)* | Keep the flag `true` in every deployed environment | `TODO(security)` | 2026-09-18 |
| KI-006 | `MailGroup.kind = SHARED` describes the same thing as `Mailbox(type = SHARED)` + `MailboxAccess`, which main already implements. The table is modelled and unused; wiring it up would give the platform two models for one concept. | P3 | *(internal only)* | Leave the model unwired. Shared mailboxes work today through the Mailbox path | `TODO(product)` — needs a decision on which representation wins | 2026-09-21 |
| KI-007 | `MailDomain` carries two verification representations: the lifecycle `status` (`DomainLifecycleStatus`) and the legacy projection `verificationStatus` (`DomainVerificationStatus`). `DomainService.synchronize` writes both in one update, so they never disagree about the same check, but they are not equivalent: `verificationStatus` reports the OWNERSHIP TXT record alone, while `status` also weighs SPF/DKIM/DMARC and `verificationDeadlineAt`. They can therefore read `PENDING_VERIFICATION` / `FAILED` together — the state a PR #46 manual re-check deliberately produces. Mailbox creation gates on `verificationStatus` (409 `DOMAIN_NOT_VERIFIED`), the owner UI and the support console both render it, and domain deactivation picks `status` from it. | P3 | *(internal only)* | Both fields are pinned by `Backend/tests/domain.status-invariants.test.ts`. Neither may be changed without the other until an owner picks one canonical field | `TODO(eng)` — needs a decision on which field wins, weighing lifecycle, mailbox creation, frontend gating, API serialization, stored data, support tools and migration compatibility | 2026-10-06 |
| KI-008 | `custom_domain_enabled` is registered as a tenant-scoped Track B rollout flag, defaults to `FLAG_CUSTOM_DOMAIN_ENABLED=false`, and is read by no route, no service and no screen. Custom-domain endpoints answer whatever the flag says. Mounting `requireFlag("custom_domain_enabled")` today would 403 a shipped, tested feature, because the default is off. | P3 | *(internal only)* | Leave it unenforced. Do not wire it without first deciding whether custom domains are meant to be rolled out per tenant, and do not flip the default silently | `TODO(product)` — either mount it as a genuine gate with an on-by-default default, or remove it with `hosted_mail_pilot_enabled`'s siblings in one change | 2026-10-06 |

## Closed

| # | Issue | Closed | Evidence |
|---|---|---|---|
| KI-100 | Support access to a workspace required no grant and was not audited | 2026-09-19 | `Backend/tests/support.access-control.test.ts` |
| KI-101 | Ticket SLA targets were 4h/8h/24h/72h against §5's 15m/1h/4bh/1bd | 2026-09-19 | `Backend/tests/ticket.sla.test.ts` |
| KI-102 | Accepting an invitation did not reach the invited workspace | 2026-09-17 | `Frontend/e2e/auth-routing.spec.ts` |
| KI-103 | MFA enrolment showed a key the server had already replaced | 2026-09-19 | `Frontend/app/verify-mfa/page.tsx` |
| KI-004 | Four tables existed with no Prisma model after PR #35; `migrate dev` would have generated 4 DROP TABLE and 6 DROP TYPE | 2026-09-21 | `prisma migrate diff` now reports no destructive statements; models recovered by introspection in `Backend/prisma/schema.prisma` |
| KI-104 | `security_alerts` was populated by nothing and read by nobody — the module, both screens and every call site went with the same merge | 2026-09-21 | `Backend/tests/security-alert.test.ts` (6 tests) |
| KI-005 | `people.mfa.reset` had no endpoint, so a locked-out user needed direct database access. Now `POST /membership/members/:membershipId/mfa/reset` (capability `people.mfa.reset`, Owner with step-up), with **Reset authenticator** in Manage member. Customer line: "If you lose your authenticator, use a recovery code, or ask your workspace Owner to reset your authenticator." | 2026-10-22 | `Backend/tests/membership.mfa-reset.test.ts`; `Frontend/components/admin/ManageMemberDialog.tsx`; commit `aea018a` |

## Customer-facing status process

`TODO(support)` — where the register is published, who updates it during an
incident, and how it relates to §11's communication templates.
