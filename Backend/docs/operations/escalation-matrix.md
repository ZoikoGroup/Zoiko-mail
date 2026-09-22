# Escalation matrix

**Owner:** Operations Lead · **Gate:** Internal Pilot (Runbook §9)
**Source:** Runbook §4 (support model) and §5 (severity)

Every name below is `TODO(ops)`. They are left blank on purpose: a plausible
placeholder is worse than an empty one, because at 03:00 nobody can tell it
apart from a real contact.

## Tiers — §4

| Tier | Owner | Scope | Escalates when |
|---|---|---|---|
| Tier 0 | Self-service / product UI | DNS guidance, connector status, mailbox status, known-issue notices, deletion/export forms | User cannot complete a flow, or a risk signal appears |
| Tier 1 | `TODO(ops)` | Login help, mailbox setup, basic delivery issues, DNS instructions, AI explanation questions | Security, data, deliverability, abuse, provider or engineering defect suspected |
| Tier 2 | `TODO(ops)` | DNS validation, provisioning errors, sync failures, bounce investigation, callback review, export/deletion tracking | Potential incident, system defect, reputation risk, data-access concern |
| Tier 3 | `TODO(eng)` `TODO(sre)` `TODO(security)` | Outage, provider outage, data integrity, tenant isolation risk, AI invariant breach, failed deletion/export | P0/P1, or code/infrastructure change required |
| Leadership | `TODO(product)` `TODO(cto)` `TODO(security-lead)` `TODO(ops-lead)` | Customer-impacting P0/P1, reputation, legal/compliance, public incident, provider failure | Immediate |

## Severity and response — §5

| Severity | Definition | Initial response | Escalates to |
|---|---|---|---|
| **P0 Critical** | Active or likely severe business, security, reputation or cross-tenant impact | **15 minutes** | Engineering, Security, CTO, Operations |
| **P1 High** | Material customer impact, workaround limited or unavailable | **1 hour** | Engineering / Security / Ops Lead |
| **P2 Medium** | Customer-impacting defect with a workaround | **4 business hours** | Technical Support / Engineering |
| **P3 Low** | Minor defect, documentation, enhancement | **1 business day** | Product / support backlog |

These four targets are enforced in code: `Backend/src/modules/ticket/sla.ts`
computes `slaDueAt` from the ticket severity, counting P2 and P3 in business
hours and P0/P1 in elapsed time. If this table and that file ever disagree,
the file is wrong — change it, do not change the table.

## Contact routes

| Channel | Business hours | Out of hours |
|---|---|---|
| Tier 1 queue | `TODO(ops)` | `TODO(ops)` |
| Engineering on-call | `TODO(eng)` | `TODO(eng)` |
| Security on-call | `TODO(security)` | `TODO(security)` |
| Incident Commander rota | `TODO(ops)` | `TODO(ops)` |
