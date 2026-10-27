# Zoiko Mail

**Business email that turns conversations into accountable work.**

Zoiko Mail is a multi-tenant email platform. It does two things that ordinary
mail clients do not:

1. **It reads your inbox for commitments.** When someone writes *"I'll send the
   contract by Friday"*, that becomes a tracked item with an owner and a date —
   not a sentence that scrolls away.
2. **It treats access as something that has to be justified.** Who can read
   whose mail, who can change what, and who was allowed in and when, are all
   decisions the system records rather than assumes.

This document describes the code as it is on the `vivekkumar` branch. Where a
feature is partial or switched off, it says so — see
[Feature status](#feature-status) before promising anything to a customer.

---

## Table of contents

1. [New here? Start with this](#new-here-start-with-this)
2. [Feature status](#feature-status)
3. [Architecture](#architecture)
4. [Technology stack](#technology-stack)
5. [Prerequisites](#prerequisites)
6. [Local setup](#local-setup)
7. [Configuration](#configuration)
8. [Database, schema and migrations](#database-schema-and-migrations)
9. [Authentication and workspace permissions](#authentication-and-workspace-permissions)
10. [Domains and DNS verification](#domains-and-dns-verification)
11. [Mailboxes](#mailboxes)
12. [Sending mail](#sending-mail)
13. [Receiving mail](#receiving-mail)
14. [SMTP, IMAP and Stalwart — what each one is for](#smtp-imap-and-stalwart--what-each-one-is-for)
15. [Attachments and previews](#attachments-and-previews)
16. [Real-time updates](#real-time-updates)
17. [API](#api)
18. [How the code is laid out](#how-the-code-is-laid-out)
19. [How security works](#how-security-works)
20. [Testing](#testing)
21. [Deployment](#deployment)
22. [Troubleshooting](#troubleshooting)
23. [Where to go next](#where-to-go-next)

---

## New here? Start with this

If you have never seen this codebase, three ideas explain most of it.

### 1. A *tenant* is a workspace, and everything belongs to one

A tenant is one company using Zoiko Mail. Every mailbox, message, domain and
audit record belongs to exactly one tenant, and no query is allowed to cross
that line. When you see `tenantId` threaded through almost every function, that
is why.

### 2. Permission is a *capability*, not a job title

Most systems ask "is this person an admin?". Zoiko Mail asks "does this person
hold `workspace.domains.remove` right now?" — and the answer can be more
interesting than yes or no:

| Answer | Meaning |
|---|---|
| `ALLOW` | Granted outright |
| `DENY` | Refused — and the error names who *does* hold it |
| `READ_ONLY` | Granted for reading only |
| `OWN` | Granted, but only over your own things |
| `STEP_UP` | Granted once you re-enter your password |
| `TWO_PERSON` | Granted once a second person approves |
| `GRANT` | Granted only while a time-boxed, approved grant is live |

There are **42 capabilities**, held by four roles (Owner, Admin, Member,
Support). The full table lives in
[`Backend/src/common/capabilities/matrix.ts`](Backend/src/common/capabilities/matrix.ts),
and it is worth reading early — it is the clearest single description of what
the product allows. The frontend keeps an identical list in
`Frontend/lib/admin-capabilities.ts`; `node Backend/scripts/check-capability-parity.mjs`
fails if the two drift.

### 3. Zoiko staff have no standing access to your workspace

Zoiko's own support team cannot read a customer's workspace by default. They
ask, the workspace owner approves, the access expires on its own, and every
read it allowed is written to the customer's audit log.

Worth separating from that: a SUPPORT member the *owner themselves invited*
into their workspace is a member of it, and reads that one workspace through
their membership — no grant, because an owner should not have to approve a
seat twice. Grants gate the cross-tenant path, where Zoiko staff reach into a
customer's data, and the one write a support seat can make. This distinction
shapes a lot of the code in `modules/support`.

---

## Feature status

At a glance:

```
 ~323  API routes            66  database models        76  migrations
   73  frontend pages        42  capabilities            4  workspaces
  113  backend test files (~1,130 tests)    45  browser spec files (~310 tests)
```

### Working end to end

| Area | What works |
|---|---|
| Accounts | Register, email OTP verification, login, workspace selection, password reset, change password, logout / logout-all |
| Security | TOTP MFA with recovery codes, step-up re-authentication, rotating refresh tokens with reuse detection, workspace-scoped sessions, security alerts |
| Permissions | 42-capability matrix enforced on every route; Owner / Admin / Member / Support consoles; per-mailbox *Workspace Access* |
| Webmail (Member) | Inbox, Sent, Drafts, Scheduled, Starred, Snoozed, Archive, Spam, Trash; threads/conversation view with quoted-history folding; compose with rich text, CC/BCC, signatures, reply / reply-all / forward; labels; bulk actions; snooze; scheduled send; resizable panes (Standard/Custom) |
| Internal mail | Mail between mailboxes on Zoiko is delivered directly and instantly |
| Attachments | Upload with type and size checks, download, inline previews for images, PDF, DOCX, DOC, text, audio and video |
| Real-time | Server-Sent Events push new mail and unread counts; reconnect, catch-up and fallback polling; tabs share one session |
| Domains | Add a custom domain, generated ownership TXT / MX / SPF / DKIM / DMARC records, background verification, DKIM rotation, automatic publishing via Cloudflare or GoDaddy credentials |
| Mailboxes | *Create Email* on a verified domain, setup (invitation) links, password reset by admin, aliases, shared mailboxes with per-person read/send rights, delegation |
| Calendar | `/mail/calendar` with invitations, rooms/resources, scheduling, sharing, templates, public booking pages (`/book/[slug]`) |
| Admin / Owner | People and roles, invitations, mailboxes, domains, groups, policies, audit log (export), security alerts, provider sync, delivery events, suppressions, data export and deletion requests, billing (Stripe) |
| Support | Tenant support console; staff console with time-boxed, owner-approved access grants; tickets |
| AI | Commitment extraction and drafting with a policy gate (mock provider by default; OpenAI when configured) |

### Works only once configured (off by default)

| Feature | Needs | Without it |
|---|---|---|
| Sending to outside addresses | `RELAY_ENABLED=true` + `RELAY_SMTP_*` (Amazon SES, Brevo or any SMTP submission service) | External recipients fail with `EXTERNAL_DELIVERY_NOT_CONFIGURED`; internal recipients still receive |
| Receiving from outside | `INBOUND_WEBHOOK_SECRET` + the Cloudflare Email Worker + Cloudflare Email Routing on the domain | The inbound endpoint answers 503 |
| System email (OTP codes, password reset, invitations, security notices) | `SYSTEM_MAIL_ENABLED=true` + `SMTP_*` + `MAIL_PROVIDER_USERNAME/PASSWORD` | Emails are logged, not sent |
| Gmail / Microsoft 365 connectors (read-only) | Google / Microsoft OAuth app credentials | Connect buttons fail |
| Google sign-in | `FLAG_GOOGLE_LOGIN_ENABLED=true` + `GOOGLE_CLIENT_ID` | Hidden/refused |
| Real AI | `AI_PROVIDER=openai` + `OPENAI_API_KEY` | Mock provider |
| Billing | `STRIPE_*` (test mode) | Billing endpoints fail closed |
| Stalwart-hosted mailboxes (IMAP access for desktop clients) | A Stalwart v0.16+ server, `STALWART_ENABLED=true`, API key in the secret store | Zoiko itself stores the mail (the current production choice) |

### Incomplete or not built — do not rely on these

- **Forwarding rules are stored but never applied.** Admins can create and
  delete them (`/mail/admin/mailboxes/:id/forwarding`), but neither internal
  delivery nor inbound ingest reads them.
- **Inbound attachments skip the upload checks.** Mail received through the
  inbound endpoint stores attachments without the extension allow-list or size
  limit, and their scan status stays `PENDING`. There is no malware scanner;
  `BLOCKED` is set only by a provider `MALWARE_DETECTED` signal.
- **Inbound ingest does not check the domain's `receivingEnabled` / MX status.**
- **Shared mailboxes get no live alert.** Inbound mail to a shared mailbox
  sends no `NEW_MAIL` event (it appears on the next refresh/poll).
- **External recipients stay `QUEUED`** after a successful relay hand-off —
  there is no delivery-status feedback loop yet (known issue KI-001).
- **Member sections shown as "Coming Soon":** Tasks, Contacts, Work Graph,
  Alet and Help centre (`Frontend/app/mail/[section]/page.tsx`). The Contacts
  *API* exists (`/api/v1/contacts`); only its member UI is missing.
- **Placeholders inside Mail:** "Summarize with Alet", "Create task", the Alet
  card, and custom folders ("coming soon").
- **Stalwart account deletion is off** (`STALWART_DELETE_ENABLED=false`) until
  message counting and stored-mail removal are verified on staging. Quota
  changes update Zoiko only, not Stalwart.
- **Lifecycle deletion** supports only some target types; others throw
  "Deletion of … targets is not implemented yet".
- **Real-time events are per-process.** SSE connections live in memory, so
  running more than one API process needs sticky sessions or a shared bus
  (not built).
- **Legacy pages** `/inbox`, `/threads`, `/ai` are kept in the code but are not
  linked from the Member UI.
- **Not enabled by design in this version:** AI sending mail on its own.

The full defect register is
[`Backend/docs/operations/known-issues.md`](Backend/docs/operations/known-issues.md).

---

## Architecture

```
                         ┌──────────────────────────────┐
   Browser ── HTTPS ───▶ │ Frontend  (Next.js, :3000)   │
                         └──────────────┬───────────────┘
                                        │ REST /api/v1  +  SSE /api/v1/events/stream
                                        ▼
 Cloudflare Email  ──HMAC-signed──▶ ┌──────────────────────────────┐ ──▶ SMTP relay (SES/Brevo)
 Worker (inbound)  POST /internal/  │ Backend API (Express, :5000)  │      outbound external mail
                   inbound/messages │  + in-process workers         │ ──▶ System SMTP (OTP, resets)
                                    │  (scheduler, jobs, DNS sync,  │ ──▶ DNS providers (Cloudflare/GoDaddy)
 Gmail / M365  ──webhooks────────▶  │   connectors, cleanup …)      │ ──▶ Stalwart (optional)
                                    └──────────────┬───────────────┘
                                                   ▼
                                    PostgreSQL 17 (Prisma, row-level security)
                                    + local disk: storage/attachments, storage/exports
                                    + secret store: env/file (dev) or GCP Secret Manager
```

- **One API process** serves HTTP and runs every background worker on timers
  (`Backend/src/server.ts`): scheduled send (15 s), snooze wake-up (60 s), job
  queue (10 s — includes `SMTP_SEND`), provider events (10 s), DNS sync (30 s),
  compliance sweep (15 min), mailbox cleanup, Gmail/M365 renewals and catch-up,
  optional IMAP sync, and an SSE heartbeat (30 s). Each worker guards against
  overlapping runs.
- **The mail store is Zoiko's own database.** Messages, threads, placements
  (which mailbox and folder), recipients and attachments are rows in Postgres;
  attachment bytes are files on disk. Stalwart is optional (see
  [below](#smtp-imap-and-stalwart--what-each-one-is-for)).
- **Two production hosts:** `api.zoikomail.com` (backend) and the web app; the
  invitation links use `APP_URL` (production: `https://sso.zoikomail.com`).

---

## Technology stack

| Layer | Technology |
|---|---|
| Backend | Node.js (ESM), TypeScript 7, Express 5, Zod 4, Prisma 6.19, PostgreSQL 17 |
| Auth | jsonwebtoken, bcrypt, TOTP MFA, Google Identity (optional) |
| Mail | nodemailer (relay + system mail), imapflow + mailparser (IMAP pilot), html-to-text, word-extractor (`.doc` previews) |
| Integrations | googleapis (Gmail), @azure/msal-node (Microsoft 365), Stripe, OpenAI, @google-cloud/secret-manager |
| Ops | pino logging, helmet, CORS allow-list, express-rate-limit, compression, Swagger UI, Prometheus-style `/api/metrics` |
| Frontend | Next.js 14.2.5 (App Router), React 18.3.1, TanStack Query 5, Zustand, Tailwind CSS 3, TipTap 3 editor, docx-preview, recharts, lucide-react |
| Tests | Vitest + Supertest against real Postgres (backend); Playwright, Chromium (frontend) |
| Packaging | Docker (`node:22-bookworm-slim`), docker compose; Cloudflare Worker for inbound mail |

---

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 22 or newer (CI and the Docker image use 22; neither `package.json` pins an engine) | Both apps |
| npm | ships with Node | Dependencies and scripts |
| Docker Desktop | current | Local PostgreSQL 17 |
| PowerShell 7 (`pwsh`) | Windows | `Backend/scripts/dev-up.ps1`, the one-command local stack |
| Git | any | — |
| Optional | `wrangler` (Cloudflare CLI) | Deploying the inbound mail worker |

Machine notes: the TypeScript type-check is memory-hungry — see
[Troubleshooting](#troubleshooting).

---

## Local setup

The repository is two apps: `Backend/` and `Frontend/`. There are two ways to
run them.

### Option A — one command (Windows, recommended)

```powershell
# 1. Backend environment (once)
cd Backend
copy .env.example .env
#    then edit .env — see "Minimum backend .env" below

# 2. Everything: Postgres, migrations, API and web app
pwsh -File scripts/dev-up.ps1
```

`dev-up.ps1` is idempotent — run it whenever you sit down to work. It:

1. starts Docker Desktop if needed and brings up **Postgres on host port
   55432** (compose with the dev overlay; the password comes from
   `POSTGRES_PASSWORD` in `Backend/.env`);
2. runs `npm install` when dependencies changed, then `prisma generate` and
   `prisma migrate deploy`;
3. starts the **API on port 5000** from source in its own window, under
   `scripts/dev-api.mjs` — a supervisor that restarts it if `/api/health`
   stops answering and appends output to `Backend/.dev-api.log`;
4. starts the **web app on port 3000** (`npm run dev`).

| Switch | Effect |
|---|---|
| `-Check` | Print a status table (ports, DB, API, a sign-in probe) and exit |
| `-Down` | Stop whatever holds ports 3000 and 5000, and stop Postgres |
| `-NoFrontend` | Stop after the API |
| `-Docker` | Run the API as a container instead of from source |

`Frontend`'s `npm run dev` also runs `scripts/ensure-api.mjs` first: if the
local API is not answering it calls `dev-up.ps1 -NoFrontend` and waits. Set
`ZOIKO_SKIP_API_CHECK=1` to skip that.

Load demo data once the API is up:

```powershell
cd Backend
npm run db:seed
```

The seed creates the tenant **Acme Corp** with users at `@acme.test`
(owners `alex@` and `helena@`, admin `devon@`, members `priya@`, `sam@`, …),
a support user `jordan@zoikosupport.test`, mailboxes, two domains, connected
accounts, policies and audit history. It prints the sign-in emails and the
shared demo password. Admin-level sign-ins need MFA; for a dev account,
`npx tsx scripts/reset-admin-mfa.ts devon@acme.test` prints a fresh TOTP key
and recovery codes.

### Option B — manual (any OS)

```bash
# 1. Database (from Backend/). The dev overlay is what publishes the port.
cd Backend
POSTGRES_PASSWORD=devpassword POSTGRES_HOST_PORT=55432 \
  docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres

# 2. Backend
cp .env.example .env          # edit it — see below
npm install
npm run db:migrate            # applies all migrations (dev mode)
npm run db:seed               # optional demo data
npm run dev                   # http://localhost:5000

# 3. Frontend (new terminal)
cd ../Frontend
npm install
npm run dev                   # http://localhost:3000
```

Two things about the database command are deliberate:

- **`POSTGRES_PASSWORD` has no default.** Compose refuses to start without one
  rather than booting a database with a guessable password.
- **The `docker-compose.dev.yml` overlay is what publishes the port.** The base
  file does not, because deployed environments must not expose the database.
  Without the overlay, Postgres runs but nothing on your machine can reach it.
  The overlay publishes `${POSTGRES_HOST_PORT:-5432}`; the scripts and tests
  in this repo assume **55432**.

### Minimum backend `.env`

Only three values are required; everything else has a default
(`Backend/src/config/env.ts`).

| Variable | What to put |
|---|---|
| `POSTGRES_PASSWORD` | The local database password (used by compose and `dev-up.ps1`) |
| `DATABASE_URL` | `postgresql://zoiko:<POSTGRES_PASSWORD>@127.0.0.1:55432/zoiko_mail?schema=public` |
| `JWT_ACCESS_SECRET` | A random string of **32+ characters** |
| `JWT_REFRESH_SECRET` | A **different** random string of 32+ characters |

Generate secrets with `openssl rand -base64 48` (or
`node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`).
Use `127.0.0.1`, not `localhost`: on Windows `localhost` resolves to IPv6 first
and Docker's IPv6 forward can stop answering after a container restart.

Never commit `.env`, `.env.local` or anything under `.secrets/`.

### Frontend configuration

No file is needed locally — the API base defaults to
`http://localhost:5000/api/v1`. To point elsewhere, create
`Frontend/.env.local`:

```bash
NEXT_PUBLIC_API_URL=https://api.example.com/api/v1   # must end in /api/v1
NEXT_PUBLIC_GOOGLE_CLIENT_ID=                         # only for Google sign-in
```

Open <http://localhost:3000>. Members sign in at `/login/member` (with their
account email *or* their mailbox address); Owners and Admins at `/login`;
Zoiko staff at `/staff/login`.

---

## Configuration

All backend settings are validated by Zod when the API starts
(`Backend/src/config/env.ts`, ~140 keys). A bad value stops startup with
"Invalid environment configuration". Booleans accept only `true` / `false`;
empty strings count as unset. `.env.example` lists only the common ones — the
tables below are the reference. **Values shown are defaults, never real
secrets.**

### Core

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test`, `production` |
| `PORT` | `5000` | |
| `DATABASE_URL` | — (required) | |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | — (required) | ≥32 chars, must differ |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | `12h` / `7d` | |
| `STEP_UP_EXPIRES_IN` | `5m` | |
| `BCRYPT_ROUNDS` | `12` | ≥10 outside tests |
| `APP_URL` | `http://localhost:3000` | Base for invitation / setup links |
| `CORS_ORIGIN` | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated exact origins, no wildcard |
| `TRUST_PROXY`, `LOG_LEVEL` | `1`, `info` | |
| `OPERATIONS_KEY` | placeholder | ≥32 chars; guards `/api/metrics` and provider health. Must be real in production |
| `PROVIDER_CALLBACK_SECRET` | placeholder | ≥32 chars. Must be real in production |
| `RATE_LIMIT_*`, `*_RATE_LIMIT_MAX` | various | Global and per-auth-route limits |
| `OTP_*`, `PASSWORD_RESET_TTL_MS`, `INVITATION_EXPIRES_IN_HOURS` | 6 digits / 10 min / 15 min / 72 h | |
| `FEATURE_FLAGS` | empty | Comma-separated rollout flags |

In production the API refuses to start if the JWT secrets, `OPERATIONS_KEY` or
`PROVIDER_CALLBACK_SECRET` look like examples (`change-me`, `example`,
`development`, `test-secret`).

### Secrets and storage

| Variable | Default | Notes |
|---|---|---|
| `SECRET_STORE` | `env` | `env` = local files / `SECRET_<REF>` env vars; `gcp` = Google Secret Manager |
| `SECRET_FILE_DIR` | `.secrets` | Where the `env` store writes (OAuth tokens, DKIM keys) |
| `SECRET_MANAGER_PROJECT` | — | GCP project when `SECRET_STORE=gcp` |
| `ENCRYPTION_KEY` | — | 64 hex chars; AES-256-GCM for tokens at rest |
| `ATTACHMENT_STORAGE_PATH` | `storage/attachments` | Local disk |
| `ATTACHMENT_MAX_SIZE_BYTES` | 10 MiB | Max 25 MiB |
| `EXPORT_STORAGE_PATH` | `storage/exports` | |

### Mail

| Variable | Default | Notes |
|---|---|---|
| `MAIL_SEND_WINDOW_MS` / `MAIL_MAX_RECIPIENTS_PER_WINDOW` | 1 h / 100 | Per-mailbox rolling cap |
| `MAIL_SCHEDULER_INTERVAL_MS`, `MAIL_SCHEDULE_MAX_ATTEMPTS` | 15 s, 3 | Scheduled send |
| `RELAY_ENABLED` | `false` | Outbound to external addresses |
| `RELAY_SMTP_HOST` / `_PORT` / `_SECURE` | — / `587` / `false` | `false` = STARTTLS required |
| `RELAY_SMTP_USERNAME` / `_PASSWORD` / `_TIMEOUT_MS` | — / — / 30 s | Required when enabled |
| `INBOUND_WEBHOOK_SECRET` | — | ≥32 chars; unset = inbound endpoint refuses everything |
| `INBOUND_MAX_MESSAGE_BYTES` / `INBOUND_SIGNATURE_TOLERANCE_MS` | 25 MiB / 5 min | |
| `SYSTEM_MAIL_ENABLED` / `SYSTEM_MAIL_FROM` | `false` / `no-reply@zoikomail.com` | Uses `SMTP_*` + `MAIL_PROVIDER_USERNAME/PASSWORD` |
| `SMTP_HOST` / `_PORT` / `_SECURE` | `smtpout.secureserver.net` / `465` / `true` | System mail and the IMAP pilot |
| `MAIL_PROVIDER_ENABLED` | `false` | Legacy single-account IMAP/SMTP pilot; needs all `MAIL_PROVIDER_*` |
| `IMAP_HOST` / `_PORT` / `_SECURE` | `imap.secureserver.net` / `993` / `true` | Pilot only |
| `STALWART_ENABLED` | `false` | Needs `STALWART_BASE_URL` (https) |
| `STALWART_ACCOUNT_PROVISIONING` | `true` | **Set `false`** to make Zoiko the mail store (production choice) |
| `STALWART_API_TOKEN_REF` | `stalwart-api-token` | A secret-store *reference*, not the key |
| `STALWART_AUTO_CREATE_DOMAINS` / `STALWART_DELETE_ENABLED` | `true` / `false` | |
| `STALWART_ACCOUNT_ROLE_ID` | empty (built-in User role) | A custom role's id; the API key must hold every permission of the role it assigns (`docs/DEPLOYMENT.md`) |

### Domains / DNS

| Variable | Default |
|---|---|
| `DNS_MX_HOSTS` | `mail.zoikomail.com:10` (`host:priority`, comma-separated) |
| `DNS_SPF_INCLUDE` / `DNS_SPF_ALL` | `_spf.zoikomail.com` / `~all` |
| `DNS_DKIM_SELECTOR_PREFIX` / `DNS_DKIM_KEY_BITS` | `zm` / `2048` |
| `DNS_DKIM_RETIRE_GRACE_MS` | 7 days |
| `DNS_DMARC_RUA`, `DNS_AUTOCONFIG_HOST`, `DNS_RESOLVER_SERVERS` | — |
| `DNS_SYNC_INTERVAL_MS` / `DNS_SYNC_BATCH_SIZE` / `DNS_RECHECK_VERIFIED_MS` | 30 s / 20 / 6 h |
| `DNS_VERIFICATION_WINDOW_HOURS` / `DNS_FAILURE_THRESHOLD` / `DNS_CHANGE_GRACE_HOURS` | 72 / 3 / 72 |

### Integrations and flags

| Variable | Default |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_ALLOWED_HD`, `GOOGLE_SIGNIN_CLIENT_ID`, `GMAIL_PUBSUB_TOPIC` | — |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI`, `MICROSOFT_NOTIFICATION_URL` | — (`MICROSOFT_TENANT_ID=common`) |
| `AI_PROVIDER` / `OPENAI_API_KEY` / `OPENAI_MODEL` | `mock` / — / `gpt-4o-mini` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` | — |
| `FLAG_MFA_ENFORCEMENT_ENABLED`, `FLAG_OUTBOUND_SENDING_ENABLED`, `FLAG_CONNECTOR_GMAIL_ENABLED`, `FLAG_CONNECTOR_M365_ENABLED`, `FLAG_AI_EXTRACTION_ENABLED`, `FLAG_AI_DRAFTING_ENABLED`, `FLAG_PROVIDER_CALLBACKS_ACCEPTING` | `true` |
| `FLAG_GOOGLE_LOGIN_ENABLED`, `FLAG_HOSTED_MAIL_PILOT_ENABLED`, `FLAG_CUSTOM_DOMAIN_ENABLED` | `false` (`FLAG_CUSTOM_DOMAIN_ENABLED` is registered but enforced nowhere — KI-008) |

Cross-checks at startup: enabling `MAIL_PROVIDER_ENABLED`, `RELAY_ENABLED`,
`STALWART_ENABLED` or `FLAG_GOOGLE_LOGIN_ENABLED` without their companion
settings is a startup error, not a runtime surprise.

---

## Database, schema and migrations

- **Schema:** [`Backend/prisma/schema.prisma`](Backend/prisma/schema.prisma) —
  66 models and 85 enums, grouped as tenancy/identity, governance (audit,
  policies, alerts, idempotency, lifecycle), mail, domains/DNS, AI,
  integrations/jobs, support, billing and calendar.
- **Migrations:** 76 folders in `Backend/prisma/migrations`, forward-only.

| Command (from `Backend/`) | Use |
|---|---|
| `npm run db:migrate` | Development: apply and create migrations (`prisma migrate dev`) |
| `npm run db:migrate:deploy` | Any shared environment: apply committed migrations only |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:seed` | Demo data (idempotent — it removes and recreates the Acme tenant) |
| `npm run db:studio` | Browse the data |

Rules:

- **Change the schema with a migration, never `prisma db push`.** CI fails if
  `schema.prisma` drifts from the migrations.
- **Row-level security** is enabled and forced on the message, thread,
  recipient, attachment, placement, commitment, AI-action, audit, participant,
  cleanup-task and all calendar tables. Policies read the session settings
  `zoiko.tenant_id` / `zoiko.cross_tenant`; the application sets them through
  `withTenant()` / `withCrossTenant()`. With neither set, those tables return
  nothing.
- **The audit log is append-only.** Triggers reject `UPDATE`, `DELETE` and
  `TRUNCATE` on `audit_events` (SQLSTATE 42501). Only a transaction that sets
  `zoiko.audit_purge = 'on'` may delete (used by retention and tests).

---

## Authentication and workspace permissions

### Sign-in

| Flow | Endpoint(s) |
|---|---|
| Register a new workspace | `POST /auth/register` → email OTP → `POST /auth/verify-otp` |
| Login | `POST /auth/login` (`{ email, password, tenantId?, workspace? }`) |
| Several workspaces | Login returns `WORKSPACE_SELECTION` + a short-lived token → `POST /auth/select-workspace` |
| MFA | `MFA_REQUIRED` / `MFA_ENROLLMENT_REQUIRED` → `/auth/mfa/challenge/{verify,enroll,confirm}` |
| Invitation | `/membership/invitations/{lookup,claim,accept}` (public, rate-limited) |
| Password | `/auth/forgot-password`, `/auth/reset-password`, `/auth/change-password` |
| Session | `/auth/refresh`, `/auth/logout`, `/auth/logout-all`, `GET /auth/me` |
| Step-up | `POST /auth/step-up` → send the token as `x-step-up-token` |
| Google | `POST /auth/google` (privileged consoles only; behind a flag) |

- Members can sign in with their account email **or their mailbox address**;
  the mailbox decides which workspace opens.
- **MFA** is required for Owner, Admin and Support consoles (and all Zoiko
  staff) while `FLAG_MFA_ENFORCEMENT_ENABLED` is on. Signing in to the
  **Member** workspace does not ask for MFA, for any role (product decision).
- **Tokens:** access token 12 h, refresh token 7 d. Refresh tokens are database
  rows that rotate on every use; presenting a used one revokes the whole
  family and records `REFRESH_TOKEN_REUSE`. Signing in to one workspace ends
  sessions in the others.
- The browser keeps tokens in `localStorage` so tabs share one session; one
  refresh is in flight at a time no matter how many requests got a 401.

### Workspaces

The access token carries the workspace it was issued for: `MEMBER`, `ADMIN`,
`OWNER` or `SUPPORT`.

| Workspace | URL | For |
|---|---|---|
| Member | `/mail` | Own mail, calendar, contacts, connected accounts. Everyone can open it |
| Admin · 16 screens | `/admin` | Day-to-day running: people, mailboxes, domains, groups, policies, provider sync, audit, security alerts. No billing, export or tenant deletion |
| Owner · 20 screens | `/owner` | Everything Admin has plus billing, export, deletion, ownership transfer and approving support access. Two actions need a second approver |
| Support | `/support` | Tenant support console, or Zoiko staff console with grants |

On **every** request the API checks that the session is still the person's
active one (`401 SESSION_SUPERSEDED`), that the token's workspace fits their
role (`403 WORKSPACE_MISMATCH`), and that the workspace is still listed in
their mailbox's **Workspace Access** setting (`403 WORKSPACE_ACCESS_NOT_ASSIGNED`).
Removing someone's Admin access therefore takes effect on their next click.

Within a workspace, each route names the capability it needs
(`requireCapability`). Members hold only `mail.own.rw`,
`commitments.own.manage` and `connector.own.connect`. Owners and Admins do
**not** hold `mail.other.read` — they cannot read members' mail.

### Support access grants

Zoiko staff request access (`SupportAccessRequest`: reason, optional ticket,
scopes, 5–240 minutes); an Owner approves, denies or lets it lapse. A live
`SupportAccessGrant` carries scopes (`TENANT_DIAGNOSTICS`, `DNS_DIAGNOSTICS`,
`DELIVERY_DIAGNOSTICS`, `AUDIT_READ`, `MAILBOX_ADMIN`, `MAIL_CONTENT`), an
expiry and an approver. Staff routes pass through `requireTenantGrant`;
without a live grant they answer nothing for that workspace.

---

## Domains and DNS verification

Code: `Backend/src/modules/domain/`. Screens: Admin/Owner → Domains.

1. **Add the domain** — `POST /api/v1/domains`. Refused if Zoiko owns it, it is
   already in your workspace, or another workspace has verified it. Zoiko
   generates an ownership token and a 2048-bit DKIM key (private key in the
   secret store; the database keeps only the public key).
2. **Publish the records** — shown on the domain page, as a BIND file
   (`GET /domains/:id/zone-file`), or published for you if a Cloudflare or
   GoDaddy credential is attached (`/domains/dns-providers`).

   | Record | Host | Value | Needed for |
   |---|---|---|---|
   | TXT | `@` | `zoiko-mail-verification=<token>` | Ownership |
   | MX | `@` | each `DNS_MX_HOSTS` entry | Receiving only |
   | TXT (SPF) | `@` | `v=spf1 include:_spf.zoikomail.com ~all` | Sending |
   | TXT (DKIM) | `zm<YYYYMM>._domainkey` | `v=DKIM1; k=rsa; p=<public key>` | Sending |
   | TXT (DMARC) | `_dmarc` | `v=DMARC1; p=none; adkim=r; aspf=r` (+ `rua` if set) | Sending |
   | CNAME | autoconfig/autodiscover | `DNS_AUTOCONFIG_HOST` | Optional |

   Automatic publishing merges into an existing SPF record, keeps an existing
   DMARC record, and replaces MX only when asked.
3. **Verification runs by itself** every 30 s for due domains (2 min → 10 min →
   1 h while pending; every 6 h once verified). "Check now" runs it
   immediately (`POST /domains/:id/diagnostics`).
4. **States:** `PENDING_VERIFICATION` → `VERIFIED` → `ACTIVE` (sending enabled
   automatically once ownership, SPF, DKIM and DMARC pass). `FAILED` if
   ownership is still missing after 72 h. An active domain that fails three
   checks in a row (outside a 72 h change grace) becomes `DEGRADED` and stops
   sending externally until the records pass again.
5. **DKIM rotation** — `POST /domains/:id/dkim/rotate`: the new key is promoted
   once its record verifies; the old one is retired after 7 days.

Mail from a domain without an active DKIM key is sent unsigned.

---

## Mailboxes

Code: `Backend/src/modules/mail/mailbox-*.service.ts`, `shared-mailbox.service.ts`,
`alias.service.ts`. Screen: Admin/Owner → Mailboxes.

### Create Email

`POST /api/v1/mail/admin/mailboxes/provision` (needs
`workspace.mailboxes.manage` and `people.invite.member`).

- The domain must be **verified**; the local part must be valid and not
  reserved (`postmaster`, `abuse`, …); the address must be unused by any
  mailbox or alias anywhere; quota must fit the plan.
- The address becomes the person's sign-in identity, created as an invited
  membership.
- **With `STALWART_ACCOUNT_PROVISIONING=false` (production):** the mailbox is
  ready immediately and the response contains a **setup link**
  (`${APP_URL}/invitation/accept?token=…`). Create Email sends **no email**;
  give the link to the person. "Generate New Link"
  (`/:id/invitation/resend`) rotates it. The link is never stored for replay.
- **With Stalwart provisioning on:** an account is also created on Stalwart;
  if Stalwart is not configured the request fails with
  `503 MAIL_HOSTING_NOT_CONFIGURED`. `/:id/provisioning/retry` retries.

### Other mailbox operations

| Operation | Endpoint (under `/mail/admin/mailboxes`) | Status |
|---|---|---|
| Set a new password | `POST /:id/credentials` (step-up) | Works; signs the person out everywhere, raises a security alert, emails a notice if system mail is on |
| Email a reset code | `POST /:id/credentials/reset-email` | Works (needs system mail) |
| Workspace Access | `PUT /:id/workspaces` | Works; defaults to `["MEMBER"]` |
| Aliases | `POST/DELETE /:id/aliases` | Works for internal and inbound routing |
| Forwarding | `POST/DELETE /:id/forwarding` | **Stored only — not applied** |
| Delegates | `GET/POST/DELETE /:id/delegates` | Works; needs an active DELEGATION policy for non-owners |
| Suspend sending | `PATCH /:id/sending` | Works |
| Delete | `DELETE /:id` (step-up) | Works in Zoiko; Stalwart account removal is off |

**Shared mailboxes** (`/mail/admin/shared-mailboxes`) are database mailboxes
with no owner; assignees get `canRead` / `canSend` / `canManage` /
`canAssign`. They appear for assignees under *Shared inboxes* in webmail
(`GET /mail/shared-inboxes`), and every list/read/send call carries
`?mailboxId=` and is checked on each request.

---

## Sending mail

`POST /api/v1/mail/drafts/:id/send` (or scheduled send). In order:

1. At least one **To** recipient.
2. Each recipient is classified **internal** (a Zoiko mailbox, alias or
   sign-in email) or **external**, and the workspace **SENDING policy** is
   evaluated. No active policy → `403 NO_ACTIVE_POLICY` (new workspaces get a
   default policy; `scripts/backfill-default-policies.ts` fixes old ones).
3. External recipients only: the sender's custom domain must have sending
   enabled (`403 DOMAIN_SEND_BLOCKED`).
4. Suppression list (bounces/complaints), mailbox **warm-up** cap
   (10 → 25 → 50 → 100 external recipients per day, `429 MAIL_WARMUP_THROTTLED`),
   the rolling per-mailbox cap (100 recipients/hour), and sending suspension.

Then:

- **Internal recipients** get the message in their Inbox immediately (status
  `DELIVERED`) and a live `NEW_MAIL` event.
- **External recipients** are queued as an `SMTP_SEND` background job, sent
  through the **relay** (`RELAY_*` — Amazon SES, Brevo or another SMTP
  submission service on port 587 with STARTTLS). The relay adds a stable
  Message-ID, `In-Reply-To` / `References` for threading, and a DKIM
  signature when the domain has an active key. With no relay configured,
  external recipients fail with `EXTERNAL_DELIVERY_NOT_CONFIGURED`.

**Scheduled send** is picked up every 15 s and retried up to 3 times.

---

## Receiving mail

### Inbound endpoint

`POST /api/v1/internal/inbound/messages` accepts a raw RFC 822 message
(≤25 MiB) with headers:

| Header | Value |
|---|---|
| `X-Zoiko-Timestamp` | Unix ms; must be within 5 minutes |
| `X-Zoiko-Recipients` | Comma-separated envelope recipients (1–100) |
| `X-Zoiko-Sender` | Envelope sender (optional) |
| `X-Zoiko-Signature` | Hex HMAC-SHA256 of `"<timestamp>.<recipients>." + body`, keyed with `INBOUND_WEBHOOK_SECRET` |

Recipients are matched to a mailbox address, then an active alias. The message
is stored once per workspace and placed in each matching mailbox's Inbox,
deduplicated on Message-ID, threaded on `In-Reply-To` / `References`, and
announced with `NEW_MAIL`. Unknown recipients get `404 INBOUND_RECIPIENT_UNKNOWN`.

### Cloudflare Email Worker

[`Backend/deploy/cloudflare-email-worker/`](Backend/deploy/cloudflare-email-worker/)
receives mail for domains on Cloudflare DNS, signs it with the scheme above and
posts it to the endpoint. It rejects unknown recipients with `550 5.1.1`, and
on other failures forwards to `BACKUP_FORWARD` (if set) or fails temporarily
so the sender retries.

```bash
cd Backend/deploy/cloudflare-email-worker
# set ZOIKO_INBOUND_URL in wrangler.toml to https://<api-host>/api/v1/internal/inbound/messages
wrangler secret put INBOUND_WEBHOOK_SECRET   # same value as the API's
wrangler deploy
# Cloudflare dashboard → Email Routing → catch-all → "Send to Worker"
```

The domain's MX must point to Cloudflare Email Routing for this path.
Domains not on Cloudflare need another inbound path (Stalwart — not yet in
use).

### Other inbound sources

- **Gmail / Microsoft 365 connectors** — read-only sync (`gmail.readonly`,
  `Mail.Read`) via push webhooks plus periodic catch-up.
- **IMAP pilot** — `MAIL_PROVIDER_ENABLED` polls one configured mailbox's
  Inbox into one mapped member. Legacy; off in production.

---

## SMTP, IMAP and Stalwart — what each one is for

| Piece | Purpose | Production today |
|---|---|---|
| Zoiko database | **The mail store** for every mailbox | In use (`STALWART_ACCOUNT_PROVISIONING=false`) |
| Relay (`RELAY_*`) | Outbound mail to external addresses | Configure SES/Brevo; Amazon SES is the plan |
| Cloudflare Email Worker | Inbound mail from the internet | Per domain on Cloudflare |
| System SMTP (`SMTP_*` + `MAIL_PROVIDER_USERNAME/PASSWORD`) | OTP codes, password resets, invitations, security notices | GoDaddy mailbox (`smtpout.secureserver.net`) |
| IMAP pilot (`MAIL_PROVIDER_ENABLED`) | Early single-account experiment | Off |
| Stalwart | Optional real mail server: IMAP/SMTP access for desktop/phone clients, inbound for non-Cloudflare domains | Off (`STALWART_ENABLED=false`) |

To enable Stalwart later: run Stalwart v0.16+, store its API key in the secret
store under `stalwart-api-token`, set `STALWART_ENABLED=true` and
`STALWART_BASE_URL`, then confirm `GET /api/stalwart/health?probe=true`
(with `x-operations-key`) reports `managementCapability: true`.

---

## Attachments and previews

**Upload** — `POST /mail/drafts/:id/attachments`, one file per request.

- Size limit `ATTACHMENT_MAX_SIZE_BYTES` (10 MiB default) → `413`; refused
  type → `415`. Storage quota is checked and charged atomically.
- **Allowed by extension:** pdf, doc, docx, odt, rtf, xls, xlsx, ods, csv,
  ppt, pptx, odp, txt, log, md, json, ics, eml, png, jpg, jpeg, gif, webp, bmp,
  heic, mp3, wav, m4a, ogg, mp4, mov, webm, zip, 7z, rar, gz, tar.
  **Refused:** HTML, scripts, executables, SVG, files without an extension.
  The stored content type is the canonical one for the extension. UTF-8
  filenames are preserved.
- Every upload needs its own `Idempotency-Key`; the web app sends one per file
  and reuses it on retry.

**Storage** — local disk under `ATTACHMENT_STORAGE_PATH`, UUID-named. There is
no object storage yet; in Docker it lives on the `zoiko_storage` volume, so
back that volume up.

**Download** — `GET /mail/:messageId/attachments/:attId` (`?mailboxId=` for a
shared mailbox). Blocked or quarantined files are refused.

**Previews** (`Frontend/components/mail/AttachmentPreview.tsx`) — every
attachment shows as a tile; clicking opens a large viewer with zoom and fit,
in the reading pane and in the composer (before sending).

| Type | Rendered by |
|---|---|
| Images, PDF, audio, video | The browser, from the downloaded file |
| Text, CSV | Read as text |
| `.docx` | `docx-preview`, in the browser |
| `.doc` | Text extracted on the server (`word-extractor`): `GET /mail/:id/attachments/:attId/preview`, or `POST /mail/attachments/preview` for a file still in the composer |
| Anything else | File details and a download button |

---

## Real-time updates

- `GET /api/v1/events/stream?token=…` — Server-Sent Events. Events:
  `CONNECTED`, `NEW_MAIL`, `UNREAD_COUNT`, `NOTIFICATION`, `JOB_COMPLETED`,
  `AI_EXTRACTION_DONE`, `AI_DRAFT_READY`, `PING` (every 30 s).
- The client (`Frontend/lib/sse-client.ts`) reconnects with backoff (1–30 s),
  treats 75 s of silence as a drop, refreshes its token before reconnecting,
  and re-reads anything missed. While the stream is down, mail lists poll.
- Sign-in, sign-out and workspace switches propagate to every open tab
  (`Frontend/lib/cross-tab-session.ts`).
- Connections are held in memory in one API process (see Feature status).

---

## API

- **Base path:** `/api/v1`. About 323 routes across 30 modules; the biggest are
  mail (65), calendar (53), support (39), auth (24), connectors (20) and
  domains (18).
- **Docs:** Swagger UI at `http://localhost:5000/api/docs`, spec at
  `/api/docs.json` (`Backend/src/config/openapi.ts`; `npm run lint:openapi`).
  A Postman collection and local environment are in `Backend/docs/`.
- **Auth:** `Authorization: Bearer <access token>`; destructive actions also
  need `x-step-up-token`.
- **Idempotency:** every tenant-scoped write (POST/PUT/PATCH/DELETE) **must**
  send `Idempotency-Key` (8–200 chars), or gets `400 IDEMPOTENCY_KEY_REQUIRED`.
  Retrying with the same key and body replays the stored response
  (`Idempotent-Replay: true`) for 24 h; the same key with a different body is
  `409 IDEMPOTENCY_PAYLOAD_MISMATCH`; while the first is running,
  `409 IDEMPOTENCY_REQUEST_IN_PROGRESS`.
- **Errors** are JSON with a stable `code` (e.g. `WORKSPACE_MISMATCH`,
  `NO_ACTIVE_POLICY`, `RATE_LIMIT_EXCEEDED`).

| Area | Mount | Highlights |
|---|---|---|
| Auth | `/auth` | register, login, OTP, select-workspace, MFA, refresh, step-up, Google |
| People | `/membership`, `/users`, `/tenants`, `/admin` | members, invitations, MFA reset, profile, capabilities, tenant settings, dashboard |
| Mail | `/mail` | list, read, update, bulk, trash, labels, signature, snooze, drafts, send, schedule, reply/forward, attachments, previews, shared inboxes |
| Mail admin | `/mail/admin/...` | mailboxes, provisioning, credentials, workspaces, aliases, forwarding, delegates, shared mailboxes, delivery events |
| Threads | `/threads`, `/messages`, `/participants` | |
| Domains | `/domains` | add, records, zone file, checks, publish, DKIM rotate, activate, DNS providers |
| Policy & audit | `/policies`, `/audit`, `/security-alerts` | evaluate, retention, events, export, review |
| Delivery | `/delivery-protection` | suppressions, warm-up |
| Connectors | `/connectors`, `/integrations` | Google/Microsoft OAuth, webhooks, sync, dead-letter replay |
| AI | `/ai`, `/actions` | actions, review |
| Lifecycle | `/lifecycle`, `/jobs` | exports, deletions, SLA |
| Support | `/support`, `/support/tickets`, `/support/platform`, `/support/platform/tickets` | console, grants, requests, investigation, tickets |
| Calendar | `/calendar`, `/public/booking` | calendars, events, invitations, shares, free/busy, resources, booking links |
| Contacts | `/contacts` | CRUD, tags, suggestions |
| Billing | `/billing` | plans, subscription, checkout, portal; webhook at `/api/v1/billing/webhook` |
| Events | `/events/stream` | SSE |
| Inbound | `/internal/inbound/messages` | HMAC-signed, no session |

**Operational endpoints** (outside `/api/v1`):

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Liveness (`UP`) |
| `GET /api/ready` | Readiness: database and storage (`READY`) |
| `GET /api/metrics` | Prometheus text; needs `x-operations-key` |
| `GET /api/stalwart/health?probe=true`, `GET /api/provider-mail/health`, `POST /api/provider-mail/sync` | Need `x-operations-key` |

---

## How the code is laid out

```
Backend/
  src/
    config/         environment (env.ts), Prisma client, logging, OpenAPI
    common/
      capabilities/ the permission matrix — read this first
      middleware/   authentication, tenant scoping, capability gates, idempotency
      mailer/       system mail (OTP, resets, invitations)
      secrets/      env/file store or GCP Secret Manager
    modules/        30 business areas, each: routes → schema → controller → service
      mail/           webmail, drafts, sending, attachments, mailboxes, shared mailboxes
      mail-transport/ outbound relay
      mail-ingest/    inbound endpoint
      domain/         DNS records, verification, DKIM, providers
      stalwart/       optional mail-server client
      …
    server.ts       HTTP server + background workers
    app.ts          middleware order and routers
  prisma/           schema, migrations, seed
  scripts/          dev-up.ps1, dev-api.mjs, fixtures and diagnostics
  deploy/           Cloudflare Email Worker
  tests/            Vitest suites
  docs/             deployment, API testing, Postman, operations runbooks

Frontend/
  app/              one folder per URL (App Router)
    mail/           Member webmail; mail/calendar; mail/[section] = Coming Soon
    admin/ owner/ support/   the other consoles
  components/       UI, grouped by area (mail/, calendar/, admin/, …)
  lib/              API clients, TanStack Query hooks, SSE, session, mail helpers
  e2e/              Playwright tests and fixtures
```

Every backend module has the same shape, so learning one teaches you the rest:

```
routes.ts      URL, HTTP method, which capability is required
schema.ts      Zod validation of the request
controller.ts  unwraps the request, calls the service
service.ts     the actual business rules and database work
```

**Frontend state has two homes:** TanStack Query owns anything that came from
the server; React state owns anything that only exists in the browser. All
HTTP goes through `Frontend/lib/api-client.ts`, which adds the bearer token and
`Idempotency-Key`, refreshes expired tokens, and tells "API not running" apart
from "CORS refused this origin".

---

## How security works

Worth understanding before changing anything, because these are enforced in
more than one place on purpose.

**Tenant isolation.** Every query filters by `tenantId` in application code,
*and* PostgreSQL row-level security enforces it underneath on the sensitive
tables. The second layer exists for the query that forgets the first.

**The audit log cannot be edited.** A database trigger rejects `UPDATE`,
`DELETE` and `TRUNCATE` on `audit_events`. Not application code — the
database. An audit log the application can rewrite is not evidence.

**Step-up authentication.** High-risk actions — removing a domain, deleting a
mailbox, resetting someone's password or MFA, rotating connector credentials,
approving support access — require re-entering your password, even in a valid
session.

**Sessions are bound to a workspace** and re-checked on every request, so
revoked access stops working immediately, and a replayed refresh token ends
every session in that workspace.

**Secrets are not in the database.** OAuth tokens, DKIM private keys and DNS
provider credentials live in GCP Secret Manager (or a local file store in
development). The database holds a reference.

**Support access expires by itself.** A grant carries scopes, a reason, and a
deadline. When it lapses, screens stop answering and the data leaves the
screen. There is no "just this once" path.

**Inbound mail is authenticated.** The ingest endpoint accepts only messages
HMAC-signed with a shared secret within a 5-minute window, and refuses
everything when the secret is unset.

---

## Testing

### Backend (Vitest, real PostgreSQL)

```powershell
cd Backend
npm test                                  # all suites (~1,130 tests in 113 files)
npx vitest run tests/auth.security.test.ts
npm run type-check
npm run lint
```

- Tests run against a **real database**, never mocks. The test database is
  `TEST_DATABASE_URL` if set, otherwise your `DATABASE_URL` with
  `/zoiko_mail` replaced by `/zoiko_mail_test`. Migrations are applied
  automatically before the run, and **every table is wiped before each
  test** — never point it at a database you care about.
- `tests/setup.ts` pins safe settings (mock AI, no system mail, no relay, fast
  bcrypt, high rate limits) and adds an `Idempotency-Key` to every write.
- Files run one at a time, so a full run takes several minutes.

### Frontend (Playwright, Chromium)

```powershell
cd Frontend
npx playwright install chromium   # once
npm run test:e2e                  # all specs
npm run test:e2e:ui               # step through them visually
npx playwright test e2e/mail-preview-real.spec.ts
npm run typecheck
```

- Most specs **stub the API** in the browser and assert on what the browser
  *sends*, not what it draws.
- The `*-real` specs and `mail-realtime.spec.ts` use the **real backend**
  (`e2e/real-harness.ts`): they need the `dev-up.ps1` stack (API :5000,
  Postgres :55432), create a throwaway `e2e-rt-*` workspace via
  `Backend/scripts/e2e-realtime-fixture.ts`, and skip themselves if the API is
  not running.
- Playwright reuses a dev server already on :3000, or starts one.

### Contract checks (repo root)

```bash
node Backend/scripts/check-capability-parity.mjs   # frontend/backend capability lists match
node Backend/scripts/check-css-tokens.mjs          # every CSS var() is defined
```

---

## Deployment

### What runs where

| Part | How it is deployed |
|---|---|
| Backend API | On the platform server, by the server-side `zoikomail-deploy` script (not in this repo), started by the **Deploy platform** GitHub workflow ([`.github/workflows/deploy-platform.yml`](.github/workflows/deploy-platform.yml), manual *Run workflow*). It SSHes in (`PLATFORM_HOST`, `PLATFORM_USER`, `PLATFORM_SSH_KEY` repository secrets) and waits up to 60 s for `https://api.zoikomail.com/api/ready` to say `READY` |
| Frontend | On the web server: `git pull`, `npm install`, `npm run build`, `pm2 restart zoiko-mail` (see `Frontend/.github/workflows/deploy.yml`) |
| Inbound mail | Cloudflare Email Worker, `wrangler deploy` |
| Database | PostgreSQL 17; migrations apply when the API container starts |

> **Note on workflow locations.** GitHub Actions only runs workflows in the
> repository-root `.github/workflows/`. `Backend/.github/workflows/ci.yml`
> (lint, type-check, tests, migration drift, browser tests, container build),
> `Backend/.github/workflows/security.yml` and
> `Frontend/.github/workflows/deploy.yml` are therefore **not executed from
> their current location** — run their steps by hand, or move them to the root
> folder, before relying on them.

### Docker

```bash
cd Backend
# Required by compose: POSTGRES_PASSWORD, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET,
# OPERATIONS_KEY, PROVIDER_CALLBACK_SECRET, CORS_ORIGIN (in .env or the shell)
docker compose up --build -d
curl http://localhost:5000/api/ready
```

The image (`node:22-bookworm-slim`, non-root) runs
`npm run db:migrate:deploy && npm start` on port 5000. Volumes:
`zoiko_postgres_data` (database) and `zoiko_storage` (attachments, exports,
file-based secrets) — **back up both**. Rollback means redeploying the
previous image; migrations are forward-only. Details:
[`Backend/docs/DEPLOYMENT.md`](Backend/docs/DEPLOYMENT.md).

### From local to production — checklist

1. **Locally:** `npm test` and `npm run type-check` in `Backend/`;
   `npm run typecheck`, `npm run build` and `npm run test:e2e` in `Frontend/`;
   both contract checks.
2. **Review migrations** in `Backend/prisma/migrations/` — the deploy script
   pauses on releases that contain migrations or compose changes
   (`zoikomail-deploy --approve-sensitive`).
3. **Merge to `main`** through a pull request.
4. **Production settings** (from
   [`LIVE_SETUP_CHECKLIST.md`](Backend/docs/operations/LIVE_SETUP_CHECKLIST.md)):
   - `NODE_ENV=production`, real JWT secrets, `OPERATIONS_KEY`,
     `PROVIDER_CALLBACK_SECRET`, `ENCRYPTION_KEY`; `CORS_ORIGIN` = the web
     app's origin; `APP_URL=https://sso.zoikomail.com`.
   - `SECRET_STORE=gcp` + `SECRET_MANAGER_PROJECT` (or the file store on the
     storage volume).
   - `STALWART_ACCOUNT_PROVISIONING=false`; keep `STALWART_ENABLED`,
     `STALWART_DELETE_ENABLED` and `MAIL_PROVIDER_ENABLED` false.
   - System mail: `SYSTEM_MAIL_ENABLED=true` with `SMTP_*` and
     `MAIL_PROVIDER_USERNAME/PASSWORD`.
   - External sending: `RELAY_ENABLED=true` + `RELAY_SMTP_*`.
   - Inbound: `INBOUND_WEBHOOK_SECRET` + the Cloudflare worker.
   - Frontend: `NEXT_PUBLIC_API_URL=https://api.zoikomail.com/api/v1`.
5. **Deploy** — run *Deploy platform* in GitHub Actions (backend); deploy the
   frontend on its server.
6. **Verify** — `/api/ready` is `READY`; add/verify a domain; Create Email →
   open the setup link → sign in; send internally, externally, and receive
   from outside; open an attachment preview.

Secrets go in the server's environment or Secret Manager — never in Git, chat
or tickets. If one is exposed, rotate it.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| "Unable to reach Zoiko Mail" / API not running | Start the stack: `pwsh -File Backend/scripts/dev-up.ps1` (or `-Check` to see what is down). API log: `Backend/.dev-api.log` |
| Same message, API *is* running | The page's origin is not in `CORS_ORIGIN`. `localhost:3000` and `127.0.0.1:3000` are different origins; both are allowed by default |
| API exits: "Invalid environment configuration" | A required value is missing or invalid (JWT secret <32 chars, same access/refresh secret, relay/Stalwart enabled without its settings). The message names the key |
| `EADDRINUSE` on 5000 or 3000 | Another copy is running: `dev-up.ps1 -Down`, then start again |
| `P1001: Can't reach database` | Postgres is not up or its port is not published (left out `-f docker-compose.dev.yml`), or `DATABASE_URL` uses `localhost`/5432 instead of `127.0.0.1:55432` |
| Compose exits: "Set POSTGRES_PASSWORD" | Working as intended — set it in `Backend/.env` or the shell |
| Login loops back to sign-in | `NEXT_PUBLIC_API_URL` is wrong or missing `/api/v1`; or the session was ended by signing in to another workspace (`SESSION_SUPERSEDED`) |
| "MFA is required for this account" | Expected for Owner/Admin/Support consoles — enrol an authenticator. Dev: `scripts/reset-admin-mfa.ts` |
| `403 WORKSPACE_ACCESS_NOT_ASSIGNED` | The person's mailbox no longer lists that workspace under Workspace Access |
| `400 IDEMPOTENCY_KEY_REQUIRED` | A write was sent without `Idempotency-Key` — use `apiRequest` in the frontend, or add the header |
| `409 IDEMPOTENCY_PAYLOAD_MISMATCH` | A key was reused for a different request; generate a new key per action |
| `403 NO_ACTIVE_POLICY` on send | The workspace has no active SENDING policy: `npx tsx scripts/backfill-default-policies.ts` |
| External recipient fails with `EXTERNAL_DELIVERY_NOT_CONFIGURED` | No relay configured — set `RELAY_ENABLED` and `RELAY_SMTP_*` |
| `403 DOMAIN_SEND_BLOCKED` | The sender's domain is not active for sending — fix its DNS records (Domains screen) |
| OTP / reset emails never arrive | `SYSTEM_MAIL_ENABLED` is false or SMTP credentials are missing. Outside production, OTP codes are also written to the API log. `scripts/diagnose-smtp.ts` tests delivery |
| Mail from outside never arrives | `INBOUND_WEBHOOK_SECRET` unset (503), the worker's secret differs, or the domain's Email Routing catch-all is not sent to the worker |
| `503 MAIL_HOSTING_NOT_CONFIGURED` on Create Email | `STALWART_ACCOUNT_PROVISIONING` is `true` without Stalwart — set it to `false` |
| Upload refused with 413 / 415 | File over `ATTACHMENT_MAX_SIZE_BYTES`, or a refused type (see the allow-list) |
| `tsc` crashes with out-of-memory | Give Node more heap: `$env:NODE_OPTIONS="--max-old-space-size=8192"` (PowerShell), and stop the dev server while type-checking on a small machine |
| `prisma generate` fails with `EPERM` (Windows) | The running API holds the Prisma engine file — stop it (`dev-up.ps1 -Down`), generate, start again |
| Backend tests cannot connect | Postgres on 55432 is not running, or `DATABASE_URL` / `TEST_DATABASE_URL` points elsewhere |
| Real-backend e2e specs are skipped | The local API is not on :5000 — start `dev-up.ps1` first |

---

## Where to go next

| I want to… | Read |
|---|---|
| Understand permissions | [`capabilities/matrix.ts`](Backend/src/common/capabilities/matrix.ts) |
| Understand the data | [`prisma/schema.prisma`](Backend/prisma/schema.prisma) |
| See every setting | [`config/env.ts`](Backend/src/config/env.ts) |
| Work on the API | [`Backend/README.md`](Backend/README.md) |
| Work on the UI | [`Frontend/README.md`](Frontend/README.md) |
| Test the API by hand | [`docs/API_TESTING.md`](Backend/docs/API_TESTING.md), the Postman collection in [`Backend/docs/`](Backend/docs/) |
| Deploy it | [`docs/DEPLOYMENT.md`](Backend/docs/DEPLOYMENT.md), [`LIVE_SETUP_CHECKLIST.md`](Backend/docs/operations/LIVE_SETUP_CHECKLIST.md) |
| Run support | [`docs/operations/`](Backend/docs/operations/README.md) |
| See known defects | [`known-issues.md`](Backend/docs/operations/known-issues.md) |

**A note on the comments.** The code explains *why* far more than *what* —
particularly where a decision looks odd. If something seems over-engineered,
the comment above it usually says which specification clause required it. Read
that before simplifying.

---

<sub>© Zoiko Tech Inc · Confidential</sub>
