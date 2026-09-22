# Zoiko Mail — Web

The Next.js application. Four workspaces, one codebase: **Member**, **Admin**,
**Owner** and **Support**.

> New to the project? Read the [root README](../README.md) first — it explains
> tenants, capabilities and support grants, which most of this code assumes.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

The API base defaults to `http://localhost:5000/api/v1`, so if the backend is
running you need no configuration at all. Override it in `.env.local`:

```bash
NEXT_PUBLIC_API_URL=https://api.example.com/api/v1
NEXT_PUBLIC_GOOGLE_CLIENT_ID=...    # only for Google sign-in
```

| Script | What it does |
|---|---|
| `npm run dev` | Development server on port 3000 |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | Next.js lint |
| `npm run test:e2e` | Playwright browser tests |
| `npm run test:e2e:ui` | Step through them visually |

---

## How it is organised

```
app/            one folder per URL — Next.js App Router
  admin/        the Admin workspace      (15 screens)
  owner/        the Owner workspace      (21 screens)
  support/      both support consoles
  inbox/  mail/  threads/  contacts/  ai/  settings/   the Member workspace
  login/  verify-mfa/  select-workspace/               getting in

components/
  admin/  owner/  support/    workspace-specific UI
  ui/  shell/                 shared primitives and layout

lib/
  *-api.ts      typed fetch wrappers — one per workspace
  *-hooks.ts    TanStack Query hooks over those wrappers
  *-nav.ts      navigation, with the capability each entry needs
  api-client.ts the single place that talks to the network

e2e/            Playwright specs
```

### Which API module do I use?

Each workspace has its own client, and they are deliberately not shared —
the Owner console and the Support console ask different questions of the same
endpoints and evolve separately.

| Workspace | Client | Hooks |
|---|---|---|
| Member | `mail-api`, `contacts-api` | `mail-hooks` |
| Admin | `admin-api`, `admin-queries` | `admin-hooks` |
| Owner | `owner-api` | `owner-hooks` |
| Support | `support-api` | `support-hooks` |

---

## Two rules worth knowing before you write code

### 1. `apiRequest` stringifies the body for you

```ts
// correct
await apiRequest("/path", { method: "POST", body: { action: "RESOLVE" } });

// wrong — double-encodes, and the server receives a string
await apiRequest("/path", { method: "POST", body: JSON.stringify({ … }) });
```

This is not hypothetical. Reviewing a security alert silently did nothing for
weeks because of exactly that, on a screen that looked completely correct.

### 2. Hiding a button is not access control

```tsx
const can = useCan();
{can("workspace.domains.remove") && <button>Remove domain</button>}
```

`useCan` exists so nobody is offered a control the server will refuse — it is
courtesy, not security. **The server checks the same capability on every
route**, and that check is the one that matters. Never reason "the button is
hidden, so the endpoint is safe".

---

## State

Two homes, and the split is deliberate:

- **TanStack Query** owns anything that came from the server — lists, entities,
  anything with a loading state. It handles caching, refetching and
  invalidation.
- **React state** owns anything that only exists in the browser — which tab is
  open, what is typed in a box, whether a dialog is showing.

If you find yourself copying server data into `useState`, that is usually a
sign the query should be doing the work.

### One deliberate exception

The support console's mailbox reader does **not** use the query cache. Every
read there is written to the customer's audit log, and serving a second look
from cache would make that record undercount. A slower screen is the right
trade against an audit trail that is wrong — the comment above it says so, so
nobody "optimises" it later.

---

## Testing

```bash
npm run test:e2e              # needs the dev server running
npm run test:e2e:ui           # visual runner, good for debugging
npx playwright test e2e/admin-people.spec.ts
```

**143 tests across 16 specs.** They assert on **what the browser sends**, not
what it draws:

```ts
// what these tests do
expect(sent[0].body.action).toBe("RESOLVE");

// what they avoid
expect(screen.getByText("Resolved")).toBeVisible();
```

A screen that renders a decision but never tells the server looks perfectly
correct in a screenshot. That class of bug is what these are for, and it is the
class they have actually caught.

### Fixtures must be complete

Several views read fields with `.length` or `.map`. A stub missing one crashes
the component during hydration, which shows up as *"element not found"* — and
reads like a product bug rather than a short fixture.

If a test fails that way, attach a listener before diagnosing further:

```ts
page.on("pageerror", (e) => console.log("PAGEERROR:" + e.message));
```

---

## Conventions

- **TypeScript strict.** `npm run typecheck` must pass.
- **Tailwind with CSS variables** — `var(--ink)`, `var(--surface)`, `var(--crit)`
  — never hard-coded colours, so light and dark themes both work.
- **Comments explain *why*.** Where something looks odd, the comment usually
  names the specification clause that required it. Read it before simplifying.
