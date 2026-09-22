# Evidence repository

**Owner:** Operations Lead · **Gate:** Internal Pilot (Runbook §9)
**Criteria:** §13 (evidence and records), §15.7

Where the records live that a pilot gate, an audit or a customer question
needs. Structure defined here; **not yet populated**.

## What must be kept

| Kind | Source | Retention | Location |
|---|---|---|---|
| Incident records | §10 incident process | `TODO(ops)` | `TODO(ops)` |
| QA certification | QA & Test Strategy | Per release | `TODO(qa)` |
| Support access records | Audit events | Per audit policy | **In-product** — see below |
| Export / deletion records | `DataLifecycleRequest` + receipts | 30-day SLA + proof | **In-product** |
| Deliverability records | Delivery + provider events | `TODO(ops)` | **In-product** |
| AI evaluation records | AI Governance spec | Per release gate | `TODO(eng)` |

## What is already in the product

Three of these do not need a separate store, and should not have one — a copy
drifts from the record it copies.

**Support access.** Every read of a workspace through the support console
writes an audit event naming the actor, the workspace, the path, the grant and
the ticket it was opened for. Refusals are recorded as `SUPPORT_ACCESS_DENIED`
and `SUPER_ADMIN` break-glass as `SUPPORT_BREAK_GLASS_ACCESS`, so §7's
"reviewed after use" has something to review.

Retrieve with: Owner console → Audit logs, filtered to `SUPPORT_*`, or
`GET /api/v1/audit/events` with a CSV export.

**Export and deletion.** `DataLifecycleRequest` records the request, approval,
confirmation and completion, and a deletion produces a receipt. The 30-day SLA
is asserted in `Backend/tests/deletion-sla.test.ts`.

**Deliverability.** Delivery and provider events are retained per tenant and
readable from both consoles.

## What has no home yet

Incident records, QA certification and AI evaluation results are produced
outside the product and have nowhere defined to live. `TODO(ops)` — pick the
store and record it here; a repository that exists only as a heading is the
gap §13 is about.
