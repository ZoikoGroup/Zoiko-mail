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
| KI-005 | `people.mfa.reset` is in the capability matrix and referenced by the UI, but no endpoint implements it. A locked-out user currently needs direct database access. | P2 | "If you lose your authenticator, contact support — we will reset it for you." | Support raises it with engineering; recovery codes avoid it entirely | `TODO(eng)` | 2026-09-18 |
| KI-006 | `MailGroup.kind = SHARED` describes the same thing as `Mailbox(type = SHARED)` + `MailboxAccess`, which main already implements. The table is modelled and unused; wiring it up would give the platform two models for one concept. | P3 | *(internal only)* | Leave the model unwired. Shared mailboxes work today through the Mailbox path | `TODO(product)` — needs a decision on which representation wins | 2026-09-21 |

## Closed

| # | Issue | Closed | Evidence |
|---|---|---|---|
| KI-100 | Support access to a workspace required no grant and was not audited | 2026-09-19 | `Backend/tests/support.access-control.test.ts` |
| KI-101 | Ticket SLA targets were 4h/8h/24h/72h against §5's 15m/1h/4bh/1bd | 2026-09-19 | `Backend/tests/ticket.sla.test.ts` |
| KI-102 | Accepting an invitation did not reach the invited workspace | 2026-09-17 | `Frontend/e2e/auth-routing.spec.ts` |
| KI-103 | MFA enrolment showed a key the server had already replaced | 2026-09-19 | `Frontend/app/verify-mfa/page.tsx` |
| KI-004 | Four tables existed with no Prisma model after PR #35; `migrate dev` would have generated 4 DROP TABLE and 6 DROP TYPE | 2026-09-21 | `prisma migrate diff` now reports no destructive statements; models recovered by introspection in `Backend/prisma/schema.prisma` |
| KI-104 | `security_alerts` was populated by nothing and read by nobody — the module, both screens and every call site went with the same merge | 2026-09-21 | `Backend/tests/security-alert.test.ts` (6 tests) |

## Customer-facing status process

`TODO(support)` — where the register is published, who updates it during an
incident, and how it relates to §11's communication templates.
