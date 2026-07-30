# Zoiko Mail — Starter (Track A: Action Inbox)

A runnable Next.js starting point for **Zoiko Mail**, the business-first email
platform that turns communication into accountable work. This scaffold builds
the **Action Inbox** — the Track A "first-ship" screen where AI-detected
commitments, replies owed, approvals and deadlines are triaged by a human.

It demonstrates the two state patterns you'll use everywhere:

- **TanStack Query** for *server state* (the commitments list, AI jobs).
- **Zustand** for *client state* (active tenant, selected item, filter).

---

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000

No backend or API keys needed — a mock route at `app/api/commitments/route.ts`
serves seed data so it runs immediately.

> Node 18.18+ or 20+ recommended.
> On Windows PowerShell the commands are the same: `npm install`, `npm run dev`.

---

## What's inside

```
zoiko-mail-starter/
├─ app/
│  ├─ api/commitments/route.ts   # mock backend (replace with real API calls)
│  ├─ globals.css                # Tailwind entry
│  ├─ layout.tsx                 # root layout, wraps app in <Providers>
│  ├─ providers.tsx              # TanStack Query provider (server state)
│  └─ page.tsx                   # renders <ActionInbox />
├─ components/
│  └─ action-inbox.tsx           # the whole screen (list + detail drawer)
├─ lib/
│  ├─ types.ts                   # Commitment types (mirror the Data Model spec)
│  ├─ store.ts                   # Zustand UI store (client state)
│  └─ api.ts                     # fetch helpers (server state)
├─ tailwind.config.ts            # brand color hooks + serif font slot
├─ package.json
└─ ...config files
```

---

## Try these interactions

- Click any card → the **detail drawer** shows the exact source email excerpt
  and a "why flagged" rationale (this is the trust anchor from the specs).
- **Confirm** / **Dismiss** → optimistic update through a TanStack Query
  `useMutation` (see `action-inbox.tsx`). No page reload.
- **Generate a draft** → mimics the async-AI pattern: POST returns `202`, then
  the client polls until the job is `succeeded`. Every draft ends in a human
  **Review & send** — the AI never sends on its own.
- Filter chips and the selected card are driven by the **Zustand** store.

---

## Wiring it to the real backend later

1. In `lib/api.ts`, point `fetchCommitments` at the real endpoint and add:
   - `Authorization: Bearer <zoiko_access_token>`
   - `X-Zoiko-Tenant-ID: <tenantId>`
   - `Idempotency-Key: <uuid>` on every mutation (confirm/dismiss/assign…).
2. Replace `app/api/commitments/route.ts` (or delete it and call the API
   directly from the client / a server action).
3. Generate types from the OpenAPI 3.1 contract instead of hand-writing
   `lib/types.ts`.
4. Move confirm/dismiss to real `POST /commitments/{id}/confirm` calls; keep
   the optimistic `onMutate` pattern already in place.

---

## Design notes

- Palette: cool slate/white base, **teal** primary, **amber** reserved for
  due/overdue only. Serif on brand + headings, sans body, mono for confidence.
- The component uses Tailwind's default `teal`/`slate`/`amber` so it runs with
  no extra setup. To apply real Zoiko brand hex, edit `tailwind.config.ts`
  (`brand.teal`, `brand.navy`, `brand.amber`) and swap the classes.
- `preview.html` (in the zip root, one level up) is a static, no-build preview
  you can open directly in a browser.

---

## Next screens to build (suggested order)

1. Connect account (Gmail / Microsoft 365 OAuth) + connection status.
2. Thread / message view (metadata-first; full body via detail fetch).
3. Daily digest.
4. Track B (gated): webmail, admin console, domain setup wizard.
