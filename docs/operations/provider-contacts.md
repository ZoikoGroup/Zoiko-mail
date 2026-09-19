# Provider contacts and escalation routes

**Owner:** Operations Lead · **Gate:** Internal Pilot (Runbook §9)
**Criterion:** §15.5 — "Provider contacts and escalation routes are recorded"

Required because §6.7 (Provider Outage Runbook) cannot be executed without
them: the runbook's first step is to confirm the outage with the provider.

| Provider | Used for | Support contact | Escalation route | Contract / SLA ref | Status page |
|---|---|---|---|---|---|
| Google (Gmail API) | Connector sync, OAuth | `TODO(ops)` | `TODO(ops)` | `TODO(legal)` | https://www.google.com/appsstatus |
| Microsoft (Graph / M365) | Connector sync, OAuth | `TODO(ops)` | `TODO(ops)` | `TODO(legal)` | https://status.office365.com |
| SMTP/IMAP host | Hosted mail send and receive | `TODO(ops)` | `TODO(ops)` | `TODO(legal)` | `TODO(ops)` |
| Stripe | Billing | `TODO(ops)` | `TODO(ops)` | `TODO(legal)` | https://status.stripe.com |
| OpenAI | AI extraction and drafting | `TODO(ops)` | `TODO(ops)` | `TODO(legal)` | https://status.openai.com |

## What to have ready before calling

Taken from §6.7. The console surfaces all of it:

- Tenant id and affected mailbox addresses — platform console, tenant view
- Provider event ids and failure codes — `Provider events`
- Delivery events and bounce codes — `Delivery events`
- Job failures and last error — `Jobs`
- Time window of first and last failure

Reading any of those for one workspace requires an active support access
grant, and every read is audited. That is deliberate and should not be worked
around during an incident: a `SUPER_ADMIN` break-glass read is available and
is recorded as break-glass for review afterwards.
