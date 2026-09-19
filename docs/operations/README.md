# Operational readiness — Zoiko Mail

Tracks the Support Readiness Checklist in **Operational Runbook & Support
Readiness Plan §9**, and holds the artefacts that checklist requires.

These are the items that gate a pilot but are not code. They live in the repo
because §13 asks for an evidence repository and because a checklist nobody can
find is not a control — not because engineering owns them. Each file names its
owner.

## Status against §9

| Area | Requirement | Gate | Status |
|---|---|---|---|
| Support staffing | Named Tier 1, Tier 2, Engineering, Security, AI and Incident Commander contacts | Internal Pilot | ⬜ [escalation-matrix.md](escalation-matrix.md) — **needs real names** |
| Runbooks | Mailbox, DNS, delivery, abuse, deletion/export, provider outage and AI issue runbooks approved | Internal Pilot | ⬜ Written in the spec (§6.1–6.8); **not yet approved or drilled** |
| Tools | Support console, audit viewer, provider status view, DNS status view, ticketing workflow | Friendly Pilot | ✅ Implemented — see [tooling.md](tooling.md) |
| Evidence repository | Incident, QA, support, export/deletion and deliverability evidence | Internal Pilot | 🟨 [evidence-repository.md](evidence-repository.md) — structure defined, **not yet populated** |
| Customer communications | Approved templates for outage, delivery issue, deletion/export, abuse suspension, pilot feedback | Friendly Pilot | 🟨 [customer-communications.md](customer-communications.md) — drafts, **not approved** |
| Escalation | Matrix with business-hour and emergency contacts | Internal Pilot | ⬜ [escalation-matrix.md](escalation-matrix.md) — **needs real contacts** |
| Known issues | Register and customer-facing status process | Friendly Pilot | 🟨 [known-issues.md](known-issues.md) — open items recorded |
| Training | Team trained on no-silent-access, AI limits, DNS basics, escalation rules | Internal Pilot | ⬜ **Not started** |
| Provider contacts | Support contacts, escalation routes, contract/SLA references | Internal Pilot | ⬜ [provider-contacts.md](provider-contacts.md) — **needs real contacts** |
| Incident process | P0/P1 process tested through tabletop exercise | Friendly Pilot | ⬜ [incident-process.md](incident-process.md) — process written, **tabletop not run** |

Legend: ✅ done · 🟨 partial · ⬜ not started

## What engineering can and cannot close

The **Tools** row is the only one code closes, and it is closed. Everything
else needs a person: a name, an approval, a rehearsal. They are written here
with the structure and the spec references already in place so that filling
them in is the remaining work, rather than deciding what they should say.

Nothing in these files is approved. Where a name, number or threshold is
missing it is marked `TODO(owner)` rather than filled with something
plausible — a placeholder that reads like a real contact is worse than a blank
one, because it is not obviously missing at the moment someone needs it.

## §15 final acceptance criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Every P0/P1 runbook has an assigned owner and escalation path | ⬜ needs owners |
| 2 | Support access is time-bound, purpose-bound and audited | ✅ enforced and tested |
| 3 | DNS, delivery, abuse, provider outage, deletion/export and AI procedures documented **and tested** | 🟨 documented in spec, not tested |
| 4 | No-autonomous-send monitoring active before external pilot | ⬜ AC-009 has no assertion |
| 5 | Provider contacts and escalation routes recorded | ⬜ |
| 6 | Customer communication templates approved | ⬜ drafts only |
| 7 | Evidence repository exists and is used | 🟨 exists, unused |
| 8 | Support team trained | ⬜ |
| 9 | Incident tabletop completed before friendly pilot | ⬜ |
| 10 | Sign-off by Product, Engineering, Security, QA, Operations, Support | ⬜ |

Criterion 2 is the one this quarter's engineering work closed; the evidence is
in `Backend/tests/support.access-control.test.ts` and
`Backend/tests/support.capability-gate.test.ts`.
