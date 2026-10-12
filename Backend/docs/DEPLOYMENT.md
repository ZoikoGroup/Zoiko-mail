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

1. **Create a dedicated API key in Stalwart** (WebUI → Account → Credentials → API Keys) for a service account. Use the permission mode *Replace* and grant only `authenticate`, `sysAccountGet`, `sysAccountQuery`, `sysAccountCreate`, `sysDomainGet`, `sysDomainQuery` and `sysDomainCreate`. Leave out every `*Destroy` permission. The key is shown once.
2. **Store the key in the secret store**, never in `.env` or the compose file:
   - `SECRET_STORE=gcp`: create the secret named by `STALWART_API_TOKEN_REF` in Secret Manager.
   - `SECRET_STORE=env`: write it to `$SECRET_FILE_DIR/stalwart-api-token.secret` (in docker-compose, `/app/storage/secrets/` on the `zoiko_storage` volume), readable only by the API user.
3. **Persist the secret store.** Each new mailbox's initial mail-server credential is written to it as `mailbox-credential-<mailboxId>`. It is never shown to anyone; losing it only means resetting that credential later.
4. **Check the connection** without exposing anything publicly:

   ```sh
   curl -H "x-operations-key: YOUR_OPERATIONS_KEY" "https://api.zoikomail.com/api/stalwart/health?probe=true"
   # expect: {"configured":true,"reachable":true,"authenticated":true,"managementCapability":true}
   ```

5. **System mail.** Invitations go out through `SYSTEM_MAIL_ENABLED`/`SYSTEM_MAIL_FROM`. With system mail off, mailboxes are still created and the invitation is recorded as not sent (`SYSTEM_MAIL_DISABLED`); it can be resent once mail is on.

Domains are registered in Stalwart on first use with DNS, certificate and DKIM management all set to *Manual*: Zoiko already tells customers what to publish and generates the domain's DKIM key itself. Set `STALWART_AUTO_CREATE_DOMAINS=false` to register domains in Stalwart by hand instead.

A mailbox being provisioned is not the same as mail flowing. Before telling a customer the address can send and receive, confirm the DNS checks on the Domains screen (ownership, MX, SPF, DKIM, DMARC), and on the server side: ports 25, 465/587 and 993 are reachable, TLS is valid for the MX host, outbound port 25 and reverse DNS (PTR) are in place, and Stalwart signs outbound mail with the DKIM key the domain publishes.

### Staging verification checklist

Run against a staging Stalwart, never against production mailboxes.

- [ ] `GET /api/stalwart/health?probe=true` reports all four flags true.
- [ ] Owner: Mailboxes → **+ Create Email** on a verified domain → Review → Confirm. Result says *Mailbox created on the mail server*, status *Invitation Pending*.
- [ ] The account exists in the Stalwart WebUI with the requested quota, and its description contains `zoiko:mailbox:<id>`.
- [ ] The invitation arrives at the recipient's existing address (not the new mailbox) and contains no password. Accepting it sets a password; the status becomes *Active*.
- [ ] Admin can do the same; a Member does not see the button, and `POST /mail/admin/mailboxes/provision` as a Member returns 403.
- [ ] Creating the same address again is refused (409) and no second Stalwart account appears.
- [ ] Revoke the API key temporarily: creation returns 202 with *Provisioning failed* (`STALWART_AUTH_FAILED`). Restore the key and press **Retry**: it finishes and creates exactly one account.
- [ ] **Resend invitation** issues a new link, and the previous link stops working.
- [ ] `audit_events` shows `MAILBOX_PROVISIONING_REQUESTED`, `MAILBOX_PROVISIONED` and `MAILBOX_INVITATION_SENT`, with no password or token in metadata. API logs contain no API key, password or invitation token.
- [ ] Send and receive a test message to and from the new address once the DNS readiness checks pass.

Not handled yet: deleting a mailbox and changing its quota update Zoiko only, not Stalwart; reading and sending mail for these mailboxes still goes through the existing single-account IMAP/SMTP pilot configuration.

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
