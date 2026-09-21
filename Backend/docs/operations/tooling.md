# Support tooling

**Owner:** Engineering · **Gate:** Friendly Pilot (Runbook §9) · **Status: ✅**

§9 requires "support console, audit viewer, provider status view, DNS status
view, and ticketing workflow available". All five exist.

| §9 requirement | Where | Notes |
|---|---|---|
| Support console | `/support` | Tenant console for a workspace's SUPPORT seat; platform console for Zoiko staff |
| Audit viewer | Both consoles → Audit | Metadata redacted via `redactMetadata` |
| Provider status view | Both consoles → Provider events | Plus delivery events and suppressions |
| DNS status view | Both consoles → Domains | MX, SPF, DKIM, DMARC per domain |
| Ticketing workflow | Platform console → Tickets | Queue, detail, comments, assignment, SLA |

## Controls the console enforces

- **No standing access.** Reading one workspace needs an active grant; expiry
  and revocation take effect on the next request, not at next sign-in.
- **Purpose-bound.** A grant carries a ticket id, or an incident named in the
  reason.
- **Audited.** Every served read writes an audit event. Refusals and
  break-glass are recorded distinctly.
- **Redacted.** A restricted mailbox's subject lines are withheld; sender,
  recipient, timestamp and error code remain, because triage runs on them.
- **Live.** Queue and alert views refresh on their own and pause while the tab
  is hidden — a 15-minute P0 target cannot be met from a static page.

## Known limitations

- The two console shells still load through their own fetch code rather than
  the shared query layer in `Frontend/lib/support-hooks.ts`. They poll, so they
  stay current; what they lack is caching and shared invalidation. Screens move
  across one at a time.
- No holiday calendar behind the business-hours SLA. Weekends are handled;
  public holidays are not, and due times land earlier than a holiday-aware
  calendar would — wrong in the safe direction.
