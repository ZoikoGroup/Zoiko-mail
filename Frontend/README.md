# Zoiko Mail — Authentication Frontend

The sign-in surface for Zoiko Mail.

**One external screen: email, password, Proceed.** Every other screen is an
outcome the platform routes to, resolved from the credentials given and what it
knows about the account. The user never chooses their own account state, so
nothing in the product advertises that those states exist.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint, zero warnings tolerated |
| `npm run verify` | Typecheck → lint → build, the CI gate |

**Stack:** Next.js 15 App Router · React 19 · TypeScript · Tailwind CSS ·
Zustand · lucide-react.

---

## Trying the scenarios

The demo password is **`Zoiko2026!`** for every account below.

**The domain is ignored — only the part before the `@` decides the outcome.**
`alex@acme.com`, `alex@gmail.com` and `alex@anything.co.uk` behave identically,
and a `+tag` is stripped. Real users arrive with whatever address their
workspace invited, so pinning the demo to one domain would make every realistic
address fall through.

| Sign in as | Outcome | Condition modelled |
| --- | --- | --- |
| `alex@…` | MFA → choose workspace → signed in | Two active memberships |
| `sarah@…` | MFA → signed in directly | One membership, so no chooser |
| **any other address** | MFA → signed in directly | Ordinary member of one workspace |
| *any* + wrong password | Generic failure, attempt counted | `attempts < 5` |
| *any* + 5 wrong attempts | Account locked, live countdown | `attempts = 5` |
| `suspended@…` | Account suspended | `AppUser.status = suspended` |
| `invited@…` | Invitation pending | `AppUser.status = invited` |
| `newstarter@…` | No workspace available | Zero active memberships |
| `contractor@…` | Membership suspended | `TenantMembership.status = suspended` |
| `ops@…` | Workspace suspended | `Tenant.status = suspended` |
| `legacy@…` | Workspace deleting | `Tenant.status = deleted_pending` |
| `tomas@…` | Dormant privileged review | 94 days idle, privileged role |
| `risky@…` | Sign-in blocked | Geo-velocity anomaly |

Your own address works: a correct password with an unrecognised local part is
treated as an ordinary member and signs in. Refusing it would be a lie about why
the attempt was rejected. In production the server holds the real status fields,
and an unknown address returns the generic failure instead.

Two arrival states are not sign-in outcomes — the platform sends a user there
mid-session. Reach them at `/signin/expired` and `/signin/revoked`.

### Resolution order

`src/constants/scenarios.ts` mirrors Security §7.2, which evaluates account and
tenant status **before** the credential check:

```
1. Pre-credential states win outright
   suspended · invited · dormant · blocked
2. Password is checked
   wrong → failed, or locked on the fifth failure
3. Remaining membership and tenant states apply
   no-workspace · membership-suspended · workspace-suspended · deleting
4. Otherwise → MFA
```

Step 1 matters: verifying a password for an account that cannot sign in either
way would tell an attacker whether the password was right.

---

## Why there is no state navigator

An earlier revision docked a list of every authentication state into the shell.
It was removed, and the removal is the point.

A visible list implies the user can pick their own account state. They cannot —
the platform resolves it, then routes. Shipping the list would have been review
scaffolding wearing product clothes.

Every state remains reachable by URL for QA. None is advertised, linked or
enumerated anywhere in the product.

---

## Project structure

```
src/
├── app/                            Routes — App Router
│   ├── layout.tsx                  Split shell + providers
│   ├── page.tsx                    → redirects to /signin
│   ├── loading.tsx                 Skeleton matching the card layout
│   ├── error.tsx                   Boundary that leaks no diagnostics
│   ├── not-found.tsx               Reveals nothing about which paths exist
│   ├── signin/
│   │   ├── page.tsx                THE login page
│   │   ├── components/
│   │   │   └── CredentialForm.tsx  Email · password · Proceed
│   │   ├── failed/                 Same form, generic failure banner
│   │   ├── mfa/                    Six-digit challenge
│   │   ├── workspace/              Membership chooser
│   │   │   └── components/
│   │   ├── locked/                 Live countdown, releases at zero
│   │   ├── blocked/                Suspicious sign-in refused
│   │   ├── dormant/                Dormant privileged review
│   │   ├── expired/                Arrival — idle timeout
│   │   ├── revoked/                Arrival — role changed
│   │   └── recovery/               Hand-off, audited
│   ├── welcome/                    Signed in
│   │   └── components/
│   ├── account/
│   │   ├── suspended/  invitation/  no-workspace/
│   ├── workspace/
│   │   ├── membership-suspended/  suspended/  deleting/
│   ├── legal/[slug]/               Terms · Privacy · Cookies
│   └── api/v1/telemetry/           Funnel + audit sink
│
├── components/
│   ├── ui/                         Button, Chip, Avatar, Card primitives
│   ├── common/                     Banner, Countdown, StepIndicator
│   ├── forms/                      TextField, OtpField, WorkspaceOption,
│   │                               OptionCard
│   └── layout/                     AuthShell, BrandPanel, AuthCard,
│                                   LegalFooter, ThemeToggle, Providers
│
├── lib/                            api-client, theme
├── hooks/                          useTheme, useSignInFlow, useOtpField,
│                                   useCountdown
├── services/                       auth-service, telemetry
├── store/                          auth-store (Zustand)
├── context/                        ThemeContext
├── types/                          auth, workspace
├── constants/                      routes, scenarios, legal
├── utils/                          cn, format, return-url
└── styles/                         globals.css — the token layer
```

**Two sources of truth.** `constants/routes.ts` holds every path;
`constants/scenarios.ts` holds the credential → outcome mapping. Nothing else
hard-codes a route.

---

## Clause traceability

Ten features on this surface, from twenty-two documented authentication
features across the thirteen Tier-0 specifications.

| # | Feature | Clause | Where |
| --- | --- | --- | --- |
| 1 | Credential authentication | PRD §11.1, §23.1 · Security §4.2, §5 | `signin/components/CredentialForm.tsx` |
| 2 | MFA challenge | PRD §17.1, §23.2 · Security §5 | `signin/mfa` |
| 3 | Active-workspace selection | Security §4.2, §6 · API §5 | `signin/workspace`, `welcome`, `account/no-workspace` |
| 4 | Failed-authentication handling | Audit §6.1 `failed_login` | `signin/failed` |
| 5 | Account & membership status | Data Model §6.2, §6.3 | `account/suspended`, `account/invitation`, `workspace/membership-suspended` |
| 6 | Workspace status | Data Model §6.1 | `workspace/suspended`, `workspace/deleting` |
| 7 | Suspicious-login response | Security §5 · Runbook §6.4 | `signin/blocked` |
| 8 | Session lifecycle messaging | QA §12 · Security §4.2, §6 | `signin/expired`, `signin/revoked` |
| 9 | Account lock | Runbook §6.4 | `signin/locked` |
| 10 | Dormant privileged review | Security §5 | `signin/dormant` |

Fifteen of the sixteen screens are named in a document. **No workspace
available** is derived — a necessary consequence of Security §4.2 requiring
every request to resolve a tenant context. With zero memberships there is
nothing to resolve, and without the screen that is a blank page. The screen says
so on itself rather than passing as a requirement.

Thirteen further documented features live off this surface: the six session
contracts, step-up, recovery, MFA reset, exceptional recovery, workspace
creation, invitation management and Support Actor sign-in.

---

## Design system

**Tokens over classes.** Light and dark are a token-level swap in
`styles/globals.css`. `prefers-color-scheme` carries the OS preference;
`data-theme` on the root element overrides it in both directions, so the manual
toggle always wins.

**Palette.** The petrol accent and the dark-mode set were validated for OKLCH
lightness band, chroma floor, colour-vision-deficiency separation and contrast
against their surface. Semantic status is a separate family, never reused for
brand.

**The brand panel is committed** — identical in both themes. That is a choice:
it is the one surface making a commercial argument, and it should look the same
to everyone.

**Three type roles.** Editorial serif for the brand thesis, system sans for the
interface, monospace for anything a person might copy or paste into a ticket.
Tabular figures wherever digits align.

---

## Accessibility

Targeting WCAG 2.2 AA:

- Contrast 4.5:1 body, 3:1 UI boundaries, both themes
- **Never colour alone** — every status carries an icon and a word
- Visible 3px focus ring on every interactive element
- `aria-live` on the failure banner; focus moves to it on rejection
- 44px minimum touch targets below `sm`
- `prefers-reduced-motion` honoured; decorative gradients drop under
  `forced-colors`
- `autoComplete` set correctly — `username`, `current-password`,
  `one-time-code` — so password managers work
- Skip link to the form; one `h1` per route

The OTP field is real: auto-advance, backspace steps back, arrow keys move, and
a pasted six-digit code fills every cell.

---

## Security posture

| Control | Where |
| --- | --- |
| One generic failure for wrong password, unknown email and deleted account | `signin/failed` |
| Lock message identical whether or not the account exists | `signin/locked` |
| Terminal states resolved before the credential check | `constants/scenarios.ts` |
| Return-URL allow-listed to internal paths | `utils/return-url.ts` |
| CSP, HSTS, frame-deny, referrer policy, `X-Robots-Tag` | `next.config.ts` |
| No indexing of a credential surface | `app/layout.tsx` metadata |
| Six identity audit events | `services/telemetry.ts` |
| Idempotency keys on side-effecting calls | `lib/api-client.ts` |

---

## Specification gaps

Four closed in this codebase, one needing a platform decision.

| Gap | Status |
| --- | --- |
| Legal & cookie links | **Closed** — every state, `components/layout/LegalFooter.tsx` |
| Return-URL validation | **Closed** — `utils/return-url.ts` |
| CSP on the auth page | **Closed** — `next.config.ts` |
| Funnel instrumentation | **Closed** — `services/telemetry.ts`, evidences PRD §22.2 Gate 3 |
| Transactional email stream for auth mail | **Open** — platform decision |

That last one matters. Invitation and verification email must send from a
subdomain outside the warm-up ladder. Sent over `zoikomail.com` it consumes
pilot sending quota and can land in spam — meaning the emails required to get
*into* the product compete with the product's own limits.

---

## The open decision

This page collects a password, which puts it on the **self-hosted credential
path**. Security §4:

> *"Zoiko Mail must use ZoikoID as the primary identity layer. Zoiko Mail must
> not implement a separate unmanaged identity system unless formally approved as
> a temporary migration control."*

That matches what the `lakhan1` branch has built — a bcrypt store with
`POST /register` and `POST /login` — but the approval still needs recording.
Gate 2 requires *"ZoikoID integration, MFA for privileged users"* as evidence,
and that cannot be produced for a system authenticating against its own password
table.

If the decision goes the other way, the password field is removed and the
`/signin` form becomes email-only with a hand-off to `id.zoiko.com`. Everything
downstream of MFA is unaffected.

---

## Backend integration

`services/auth-service.ts` calls `/api/v1/*` with a bearer token, tenant
header, request ID and — on side-effecting calls — an idempotency key.

`POST /auth/sign-in` is the one to build first. It should return the same
`Scenario` shape the local resolver produces, so removing the fallback changes
nothing downstream. The server is authoritative: it evaluates the status fields
and risk signals in the §7.2 order and answers with one outcome.

**One schema dependency** for the surfaces beyond sign-in: `Commitment` needs
`commitmentType`, `sourceExcerpt`, `confidenceScore` and `aiActionId`, and
`Participant` needs to exist. Unrelated to this project, but it blocks the next.
