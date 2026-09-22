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

---

## Table of contents

- [New here? Start with this](#new-here-start-with-this)
- [What you get](#what-you-get)
- [The four workspaces](#the-four-workspaces)
- [Running it locally](#running-it-locally)
- [How the code is laid out](#how-the-code-is-laid-out)
- [How security works](#how-security-works)
- [Testing](#testing)
- [Where to go next](#where-to-go-next)

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
| `OWN` | Granted, but only over your own things |
| `STEP_UP` | Granted once you re-enter your password |
| `TWO_PERSON` | Granted once a second person approves |
| `GRANT` | Granted only while a time-boxed, approved grant is live |

There are **41 capabilities**. The full table lives in
[`Backend/src/common/capabilities/matrix.ts`](Backend/src/common/capabilities/matrix.ts),
and it is worth reading early — it is the clearest single description of what
the product allows.

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

## What you get

```
232  API endpoints          50  database models        59  migrations
 59  frontend pages         41  capabilities            4  workspaces
655  backend tests         143  browser tests
```

**Implemented and tested**

- Email: mailboxes, aliases, forwarding, threads, attachments, shared mailboxes
- Gmail and Microsoft 365 connectors (read-only), with signed webhooks, retry
  with backoff, dead-letter replay and provider health
- Hosted mail over IMAP/SMTP, sending as background jobs
- AI commitment detection with a policy gate and per-mailbox opt-out
- Domains: DNS verification for MX, SPF, DKIM and DMARC before sending is
  allowed
- Deliverability: mailbox warm-up, send caps, bounce and complaint suppression
- Authentication: MFA, recovery codes, step-up, rotating refresh tokens
- Billing via Stripe; audit log that the application cannot edit

**Deliberately not enabled yet** — these need provider credentials or a
business decision, not more code: real OAuth consent screens, outbound mail at
scale, and AI sending mail on its own (which the specification forbids in this
version).

---

## The four workspaces

One codebase, four very different jobs. Which one you land in is decided at
sign-in by your role.

### Member — *"my mail and my commitments"*
Inbox, threads, contacts, the AI action list, connected accounts, personal
settings. A member sees their own things and nothing else.

### Admin — *"run the workspace"* · 15 screens
People and roles, mailboxes, domains, groups, policies, provider sync, audit
log, security alerts. An Admin is the **bounded operator**: they can run the
workspace day to day but hold none of the liability capabilities — no billing,
no data export, no deleting the tenant.

### Owner — *"answer for the workspace"* · 21 screens
Everything an Admin has, plus the things someone must be accountable for:
billing, data export, deletion requests, ownership, and approving support
access. Two actions require a second approver.

### Support — *"help a customer, on the record"*
Two consoles in one route, and the difference between them is the whole design.
A workspace's own support member — invited by its owner — reads that one
workspace through their membership; every answer is pinned to their tenant, so
the console cannot reach anywhere else. Zoiko staff getting the fleet-wide view
are on the other side of that line: reaching into a customer's workspace needs
a time-boxed grant the owner approves, and every read it allows is written to
the customer's audit log. Changing a mailbox setting — the one write support
has — needs a grant naming that scope, whoever is asking.

---

## Running it locally

**You need:** Node.js 22+, Docker Desktop, and about ten minutes.

### 1. Start the database

```bash
cd Backend
POSTGRES_PASSWORD=devpassword docker compose   -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
```

Two things about that command are deliberate and will bite you if you shorten
it:

- **`POSTGRES_PASSWORD` has no default.** Compose refuses to start without one
  rather than booting a database with a guessable password.
- **The `docker-compose.dev.yml` overlay is what publishes port 5432 to your
  machine.** The base file does not, because Infrastructure §8 forbids public
  database access in deployed environments. Without the overlay, Postgres runs
  but `prisma migrate` cannot reach it.

### 2. Configure the backend

```bash
cp .env.example .env
```

Three values in `.env` must be set — everything else has a working default:

| Variable | What to put |
|---|---|
| `DATABASE_URL` | `postgresql://zoiko:devpassword@localhost:5432/zoiko_mail?schema=public` |
| `JWT_ACCESS_SECRET` | any random string of **32+ characters** |
| `JWT_REFRESH_SECRET` | a **different** random string of 32+ characters |

> Generate one with `openssl rand -base64 48`. The app refuses to start with a
> short secret rather than running insecurely — if it exits complaining about
> configuration, that is the check working.

### 3. Create the schema and start the API

```bash
npm install
npm run db:migrate      # builds the tables
npm run db:seed         # optional: demo tenant and users
npm run dev             # http://localhost:5000
```

### 4. Start the web app

```bash
cd ../Frontend
npm install
npm run dev             # http://localhost:3000
```

No configuration needed for local development — the API base defaults to
`http://localhost:5000/api/v1`, which is where step 3 left the backend. Point
it elsewhere with `NEXT_PUBLIC_API_URL` in `.env.local` when you need to.

Open <http://localhost:3000>, register, and you will be asked to set up
two-factor authentication — Owners, Admins and Support must have it. Any TOTP
app works (Google Authenticator, 1Password, Authy).

### Troubleshooting

| Symptom | Cause |
|---|---|
| API exits on start, mentions configuration | A JWT secret is missing or under 32 characters |
| `P1001: Can't reach database` | Postgres is up but its port is not published — you left out `-f docker-compose.dev.yml` |
| Compose exits: `Set POSTGRES_PASSWORD` | Working as intended — pass the variable |
| Login loops back to the sign-in page | `NEXT_PUBLIC_API_URL` is wrong or missing `/api/v1` |
| "MFA is required for this account" | Expected for privileged roles — enrol an authenticator |

---

## How the code is laid out

The repository is exactly two folders.

```
Backend/     Express + TypeScript + PostgreSQL (Prisma)
Frontend/    Next.js App Router + React + Tailwind
```

### Backend

A **modular monolith**: one deployment, one database, but each business area
owns its own routes, validation and service logic.

```
Backend/src/
  config/         environment, Prisma client, logging, OpenAPI
  common/
    capabilities/ the permission matrix — read this first
    middleware/   authentication, tenant scoping, capability gates
    secrets/      GCP Secret Manager (OAuth tokens never touch the database)
  modules/        25 business areas, each: routes → controller → service
```

Every module follows the same shape, so learning one teaches you the rest:

```
routes.ts      URL, HTTP method, which capability is required
schema.ts      Zod validation of the request
controller.ts  unwraps the request, calls the service
service.ts     the actual business rules and database work
```

### Frontend

```
Frontend/
  app/          one folder per URL (Next.js App Router)
    admin/      the Admin workspace
    owner/      the Owner workspace
    support/    both support consoles
    (rest)      the Member workspace
  components/   shared UI, grouped by workspace
  lib/          API clients and TanStack Query hooks
  e2e/          Playwright browser tests
```

**State has two homes**, and the split matters: **TanStack Query** owns
anything that came from the server; React state owns anything that only exists
in the browser.

---

## How security works

Worth understanding before changing anything, because these are enforced in
more than one place on purpose.

**Tenant isolation.** Every query filters by `tenantId` in application code,
*and* PostgreSQL row-level security enforces it underneath on the sensitive
tables. The second layer exists for the query that forgets the first.

**The audit log cannot be edited.** A database trigger rejects `UPDATE` and
`DELETE` on `audit_events`. Not application code — the database. An audit log
the application can rewrite is not evidence.

**Step-up authentication.** High-risk actions — removing a domain, deleting a
mailbox, exporting data, approving support access — require re-entering your
password, even in a valid session.

**Secrets are not in the database.** OAuth tokens live in GCP Secret Manager
(or a local file store in development). The database holds a reference.

**Support access expires by itself.** A grant carries scopes, a reason, and a
deadline. When it lapses, screens stop answering and the data leaves the
screen. There is no "just this once" path.

---

## Testing

```bash
# Backend — needs Postgres running
cd Backend
npm test                      # 653 tests
npx vitest run tests/auth.security.test.ts

# Frontend — needs the dev server running
cd Frontend
npm run test:e2e              # 143 browser tests
npm run test:e2e:ui           # step through them visually
```

Backend tests run against a **real PostgreSQL database**, not mocks. They are
slower for it, and they catch the things that matter — a missing tenant filter,
a migration that does not apply, a capability that resolves the wrong way.

Browser tests assert on **what the browser sends**, not what it draws. A screen
that renders a decision but never tells the server looks perfectly correct in a
screenshot — that class of bug is exactly what these are for.

---

## Where to go next

| I want to… | Read |
|---|---|
| Understand permissions | [`capabilities/matrix.ts`](Backend/src/common/capabilities/matrix.ts) |
| Understand the data | [`prisma/schema.prisma`](Backend/prisma/schema.prisma) |
| Work on the API | [`Backend/README.md`](Backend/README.md) |
| Work on the UI | [`Frontend/README.md`](Frontend/README.md) |
| Deploy it | [`docs/DEPLOYMENT.md`](Backend/docs/DEPLOYMENT.md) |
| Run support | [`docs/operations/`](Backend/docs/operations/README.md) |
| See known defects | [`known-issues.md`](Backend/docs/operations/known-issues.md) |

**A note on the comments.** The code explains *why* far more than *what* —
particularly where a decision looks odd. If something seems over-engineered,
the comment above it usually says which specification clause required it. Read
that before simplifying.

---

<sub>© Zoiko Tech Inc · Confidential</sub>
