# Zoiko Mail backend deployment

## Required secrets

Create a deployment `.env` file that is never committed:

```env
POSTGRES_PASSWORD=replace-with-a-strong-database-password
JWT_ACCESS_SECRET=replace-with-at-least-32-random-characters
JWT_REFRESH_SECRET=replace-with-a-different-32-character-secret
OPERATIONS_KEY=replace-with-at-least-32-random-characters
PROVIDER_CALLBACK_SECRET=replace-with-a-different-32-character-secret
CORS_ORIGIN=https://mail.example.com
API_PORT=5000

# Enable only when the live mailbox is required in this environment
MAIL_PROVIDER_ENABLED=true
IMAP_HOST=imap.secureserver.net
IMAP_PORT=993
IMAP_SECURE=true
SMTP_HOST=smtpout.secureserver.net
SMTP_PORT=465
SMTP_SECURE=true
MAIL_PROVIDER_USERNAME=info@example.com
MAIL_PROVIDER_PASSWORD=store-this-in-the-platform-secret-manager
MAIL_PROVIDER_FROM_ADDRESS=info@example.com
MAIL_PROVIDER_TENANT_ID=replace-with-the-active-tenant-uuid
MAIL_PROVIDER_MEMBERSHIP_ID=replace-with-the-active-membership-uuid
MAIL_PROVIDER_SYNC_INTERVAL_MS=300000
```

The application secrets must be different. Production startup rejects example or development secrets. Never commit the provider password; use the deployment platform's secret manager.

## Custom-domain DNS

Customer domains are told to publish records that point at the platform, so the platform side must exist first:

```env
DNS_MX_HOSTS=mx1.zoikomail.com:10,mx2.zoikomail.com:20
DNS_SPF_INCLUDE=_spf.zoikomail.com
DNS_RESOLVER_SERVERS=1.1.1.1,8.8.8.8
SECRET_STORE=gcp
SECRET_MANAGER_PROJECT=your-gcp-project
```

1. Each host in `DNS_MX_HOSTS` must resolve and accept mail for customer domains.
2. `DNS_SPF_INCLUDE` must publish the sending IPs itself, for example `_spf.zoikomail.com TXT "v=spf1 ip4:203.0.113.10 -all"`. Customer SPF records include it, so an empty or missing record fails SPF for every customer.
3. DKIM private keys and DNS provider credentials are written to the secret store. With `SECRET_STORE=env`, `SECRET_FILE_DIR` must be on persistent storage (docker-compose puts it on the `zoiko_storage` volume); losing it stops DKIM signing.

The API synchronizes domains itself: every `DNS_SYNC_INTERVAL_MS` it reconciles, publishes (when a DNS provider is connected) and verifies each domain that is due, fast while records are being set up and every `DNS_RECHECK_VERIFIED_MS` once healthy. A sending domain whose required records fail `DNS_FAILURE_THRESHOLD` checks in a row is suspended and resumes by itself when they pass. Changing `DNS_MX_HOSTS` or `DNS_SPF_INCLUDE` regenerates every domain's records, with `DNS_CHANGE_GRACE_HOURS` before any suspension.

## Hosted mailboxes (Stalwart)

"Create Email" creates the real account on Stalwart and the matching Zoiko record. It needs **Stalwart v0.16 or later**: v0.16 removed the REST management API (`/api/principal`) and moved management onto JMAP (`/jmap`, capability `urn:stalwart:jmap`, methods `x:Domain/*` and `x:Account/*`). Until this is configured, the endpoint answers `503 MAIL_HOSTING_NOT_CONFIGURED` and creates nothing.

```env
STALWART_ENABLED=true
STALWART_BASE_URL=https://mail.zoikomail.com   # the server origin, not /admin or /account
STALWART_API_TOKEN_REF=stalwart-api-token      # secret-store reference, not the key
STALWART_TIMEOUT_MS=15000
STALWART_AUTO_CREATE_DOMAINS=true
```

1. **Create a dedicated API key in Stalwart** (WebUI → Account → Credentials → API Keys) for a service account. Use the permission mode *Replace* and grant only `authenticate`, `sysAccountGet`, `sysAccountQuery`, `sysAccountCreate`, `sysDomainGet`, `sysDomainQuery` and `sysDomainCreate`. Leave out every `*Destroy` permission **for as long as deletion is off** (see *Deleting hosted mailboxes* below, which is the only reason to add `sysAccountDestroy`). The key is shown once.
2. **Store the key in the secret store**, never in `.env` or the compose file:
   - `SECRET_STORE=gcp`: create the secret named by `STALWART_API_TOKEN_REF` in Secret Manager.
   - `SECRET_STORE=env`: write it to `$SECRET_FILE_DIR/stalwart-api-token.secret` (in docker-compose, `/app/storage/secrets/` on the `zoiko_storage` volume), readable only by the API user.
3. **Persist the secret store.** Each new mailbox's initial mail-server credential is written to it as `mailbox-credential-<mailboxId>`. It is never shown to anyone; losing it only means resetting that credential later.
4. **Check the connection** without exposing anything publicly:

   ```sh
   curl -H "x-operations-key: YOUR_OPERATIONS_KEY" "https://api.zoikomail.com/api/stalwart/health?probe=true"
   # expect: {"configured":true,"reachable":true,"authenticated":true,"managementCapability":true}
   ```

5. **System mail.** Create Email does not use it. Every new mailbox returns an invitation link (`${APP_URL}/invitation/accept?token=...`) for the Owner or Admin to copy and pass on, whatever `SYSTEM_MAIL_ENABLED` says; nothing is emailed. `SYSTEM_MAIL_ENABLED`/`SYSTEM_MAIL_FROM` are still needed for sign-up verification codes, password reset, MFA-related emails and workspace invitations from Users & Roles (with system mail off, those invitations show the admin the link instead).

Domains are registered in Stalwart on first use with DNS, certificate and DKIM management all set to *Manual*: Zoiko already tells customers what to publish and generates the domain's DKIM key itself. Set `STALWART_AUTO_CREATE_DOMAINS=false` to register domains in Stalwart by hand instead.

A mailbox being provisioned is not the same as mail flowing. Before telling a customer the address can send and receive, confirm the DNS checks on the Domains screen (ownership, MX, SPF, DKIM, DMARC), and on the server side: ports 25, 465/587 and 993 are reachable, TLS is valid for the MX host, outbound port 25 and reverse DNS (PTR) are in place, and Stalwart signs outbound mail with the DKIM key the domain publishes.

### Staging verification checklist

Run against a staging Stalwart, never against production mailboxes.

- [ ] `GET /api/stalwart/health?probe=true` reports all four flags true.
- [ ] Owner: Mailboxes → **+ Create Email** on a verified domain → Review → Confirm. Result says *Mailbox created on the mail server*, status *Setup Pending*, with an invitation link to copy.
- [ ] The account exists in the Stalwart WebUI with the requested quota, and its description contains `zoiko:mailbox:<id>`.
- [ ] No email is sent. Opening the link shows *You're invited to Zoiko Mail*; choosing a password there leads to the member sign-in (`/login/member`), where the new address signs in. The status becomes *Ready*.
- [ ] Admin can do the same; a Member does not see the button, and `POST /mail/admin/mailboxes/provision` as a Member returns 403.
- [ ] Creating the same address again is refused (409) and no second Stalwart account appears.
- [ ] Revoke the API key temporarily: creation returns 202 with *Provisioning failed* (`STALWART_AUTH_FAILED`). Restore the key and press **Retry**: it finishes and creates exactly one account.
- [ ] **Generate New Link** issues a new link, and the previous link stops working.
- [ ] `audit_events` shows `MAILBOX_PROVISIONING_REQUESTED`, `MAILBOX_PROVISIONED` and `MAILBOX_SETUP_LINK_ISSUED` (and `MAILBOX_SETUP_LINK_REGENERATED` after a new link), with no password or token in metadata. API logs contain no API key, password or invitation token.
- [ ] Send and receive a test message to and from the new address once the DNS readiness checks pass.

Not handled yet: changing a mailbox's quota updates Zoiko only, not Stalwart; reading and sending mail for these mailboxes still goes through the existing single-account IMAP/SMTP pilot configuration.

### Deleting hosted mailboxes

Deleting a hosted mailbox, erasing a member, or erasing a workspace has to remove the account on Stalwart as well. Zoiko records that work in a durable table (`mail_provider_cleanup_tasks`, written in the same transaction that deletes its own rows, with no foreign keys so it survives the tenant) and a background worker does it.

**It is off by default and must stay off until the checks below pass:**

```env
STALWART_DELETE_ENABLED=false     # default
MAIL_CLEANUP_INTERVAL_MS=30000    # how often the worker looks for due tasks
MAIL_CLEANUP_LEASE_MS=300000      # a task held longer than this is taken over (worker crash)
MAIL_CLEANUP_RETENTION_DAYS=90    # completed tasks are kept this long, then purged
```

While it is off: an admin's request to delete a hosted mailbox is refused (`503 MAILBOX_DELETE_DISABLED`) and nothing changes — no orphaned account, no half-deleted row. Mailboxes that were never hosted delete exactly as before. Tasks queued by member or workspace erasure are still written, and wait: the worker does not run and uses no attempts. Turning the flag on lets them run.

**What is verified, and what is not.** Against Stalwart's published documentation (account object reference, https://stalw.art/docs/ref/object/account/):

| Behaviour | Status |
|---|---|
| Destroy is `x:Account/set` with `destroy: [id]`, standard JMAP set semantics | Documented |
| Destroy needs the `sysAccountDestroy` permission | Documented |
| `description` is a free-text account property (carries the `zoiko:mailbox:<id>` marker) | Documented |
| `usedDiskQuota` is a server-set byte count; there is **no message-count property** | Documented. It is deliberately not used as a substitute for a count |
| The management API key may query another account's mail (`Email/query`, `accountId`) | **Not verified.** Stalwart documents the *impersonate* permission as the way to reach other mailboxes over JMAP, and advises against using administrator credentials for mail access. Until this is verified the count fails closed (`COUNT_UNAVAILABLE`), so an admin delete is refused rather than assumed safe |
| What destroying an account does to its stored mail | **Not documented.** Erasure relies on it; confirm it |
| The response shape of a refused destroy (`notDestroyed` with `notFound`/`forbidden`) | Standard RFC 8620; confirm against the server |

**The count never guesses.** `countMessages` returns a number only for a reliably read, non-negative integer total for exactly the account asked about. A session that does not list the account, does not offer the JMAP mail capability, any error, or any malformed answer is "could not tell", and an admin delete is refused. Do not grant the *impersonate* permission to the management key to make it pass without a deliberate security decision: it would let that key read every customer's mail.

**Ownership is proved before any account is destroyed.** The account must carry `zoiko:mailbox:<mailboxId>` in its description and have the mailbox's own name and domain. Anything else is left alone and the task is marked blocked.

**Permission to add, only when deletion is enabled:** `sysAccountDestroy` (and keep `sysAccountGet`/`sysAccountQuery`). Without it a destroy is refused (`FORBIDDEN`) and the task is dead-lettered with a visible error.

**Migration:** `20261013120000_mail_provider_cleanup` is additive (two nullable columns on `mailboxes`, one new table and its enums, with row-level security). Review it, take a backup, and apply it with `prisma migrate deploy` as usual. It has been applied only to the local throwaway test database.

#### Staging checks before enabling `STALWART_DELETE_ENABLED`

Run against a staging Stalwart with test mailboxes, never production customers.

- [ ] Using the management key: `Email/query` with `calculateTotal` on a *test* account returns the right total — or is refused. If refused, decide deliberately how to count (do not use `usedDiskQuota` as a stand-in, and do not add *impersonate* casually). Until then keep deletion off.
- [ ] A mailbox holding a few messages: `DELETE /mail/admin/mailboxes/:id` returns `409 MAILBOX_NOT_EMPTY`; nothing is destroyed.
- [ ] An empty hosted mailbox: returns `202`, status *Deleting*; within a worker interval the account disappears from Stalwart, then the Zoiko row, then the secret `mailbox-credential-<id>`; `audit_events` has `MAILBOX_DELETION_REQUESTED`, `MAILBOX_DELETED`, `MAILBOX_PROVIDER_CLEANUP_COMPLETED`.
- [ ] The same address can be created again afterwards, as a new account.
- [ ] Destroying an account really removes its stored mail (check blob storage / the account's data), since erasure depends on it.
- [ ] Remove `sysAccountDestroy` from the key: the task is dead-lettered (`STALWART_FORBIDDEN`), the mailbox stays *Deleting* with the error shown. Restore it, call `POST /mail/admin/mailboxes/:id/deletion/retry`: it completes.
- [ ] Rename an account's description in the WebUI so the marker is gone, then delete its mailbox: the task is *blocked* (`OWNERSHIP_MISMATCH`) and the account is untouched.
- [ ] Stop the API mid-deletion and restart it: the task is taken over after `MAIL_CLEANUP_LEASE_MS` and finishes without creating or destroying anything twice.
- [ ] Erase a test member who has a hosted mailbox, and a test workspace: the tasks are written, survive the tenant, and the accounts are removed once enabled. Completed tasks show a redacted address and are purged after `MAIL_CLEANUP_RETENTION_DAYS`.

## Start

```sh
docker compose up --build -d
docker compose ps
```

The API waits for PostgreSQL, applies committed Prisma migrations, and starts as a non-root user.

## Verify

```sh
curl http://localhost:5000/api/health
curl http://localhost:5000/api/ready
curl -H "x-operations-key: YOUR_OPERATIONS_KEY" http://localhost:5000/api/metrics
```

Swagger documentation is available at `http://localhost:5000/api/docs/`.

## Persistent data

- `zoiko_postgres_data` stores PostgreSQL data.
- `zoiko_storage` stores attachments, generated exports and, with `SECRET_STORE=env`, the secret files (DKIM keys, DNS provider credentials, connector tokens).

Back up both volumes. Restoring only one can leave attachment metadata and stored files inconsistent.

## Update

```sh
git pull
docker compose up --build -d
```

Only committed migrations are deployed. Never use `prisma db push` against production.

## Rollback

Deploy the previous application image. Prisma migrations are forward-only, so database rollback requires a reviewed recovery migration or a verified database backup.
