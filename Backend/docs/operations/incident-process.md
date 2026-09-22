# Incident management

**Owner:** Operations Lead · **Gate:** Friendly Pilot (Runbook §9, §10)
**Criterion:** §15.9 — "Incident tabletop exercise completed before friendly
customer pilot"

## Roles

| Role | Holder | Responsibility |
|---|---|---|
| Incident Commander | `TODO(ops)` | Owns the incident; the only person who declares severity and closes it |
| Communications | `TODO(support)` | Every customer-facing line; nobody else sends one |
| Technical lead | `TODO(eng)` | Diagnosis and remediation |
| Security | `TODO(security)` | Any incident with a data or access dimension |
| Scribe | `TODO(ops)` | Timeline as it happens, not reconstructed afterwards |

## P0 / P1 flow

1. **Detect** — alert, customer report, or support console
2. **Declare** — Incident Commander sets severity against §5
3. **Notify** — per [escalation-matrix.md](escalation-matrix.md). P0 initial
   response is **15 minutes**
4. **Contain** — stop the bleeding before diagnosing. Suspending sending is
   reversible; a lost mailbox is not
5. **Communicate** — [customer-communications.md](customer-communications.md).
   First update names what is known, what is not, and when the next one comes
6. **Resolve**
7. **Review** — within five working days; blameless; output is actions with
   owners and dates

## Access during an incident

Reading a workspace needs an active support access grant. A `SUPER_ADMIN`
break-glass read is available when there is no time to obtain one, and is
recorded distinctly for review.

**Break-glass is not a shortcut around approval — it is approval deferred.**
Every break-glass read appears in the post-incident review.

## Tabletop record

§15.9 gates the friendly pilot on a tabletop having been run. Record each one.

| Date | Scenario | Participants | Findings | Actions |
|---|---|---|---|---|
| — | — | — | — | — |

**No tabletop has been run.** Suggested first scenario, because it is the one
with the shortest clock and the widest blast radius: *cross-tenant data
exposure reported by a pilot customer at 02:00.*
