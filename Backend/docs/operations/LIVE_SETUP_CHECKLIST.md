# Live setup checklist: Create Email, invitations and mail

For whoever runs the live server. Everything here is a setting or an outside
service, not code. Setting names are the ones the API reads (`src/config/env.ts`);
the API container only receives the variables named in `Backend/docker-compose.yml`
(this release adds the ones that were missing, so redeploy it before relying on them).

## 1. Create Email on live (do this first)

Deploy the latest `main`, then in the server's `Backend/.env`:

| Setting | Value | Why |
|---|---|---|
| `STALWART_ACCOUNT_PROVISIONING` | `false` | Create Email stores the mailbox in Zoiko and does not call Stalwart. Left at the default (`true`) it needs a Stalwart key with permission, and fails with 403 until it has one. |
| `APP_URL` | `https://sso.zoikomail.com` | The address invitation links point at. Skip if the server's override file already sets it. |
| `STALWART_ENABLED` | `false` | Leave off until the Stalwart key has permission (see section 5). |
| `STALWART_DELETE_ENABLED` | `false` | Leave off. Deleting hosted Stalwart mailboxes is not verified yet. |
| `MAIL_PROVIDER_ENABLED` | `false` | The old single-account IMAP pilot. Leaving it on with IDs that do not exist fills the logs with errors. |

Also: the domain must be verified on the Domains page, and its DKIM, SPF and
DMARC records must pass, or sending for it is suspended.

Deploy with `zoikomail-deploy --approve-sensitive`. It pauses first because this
release adds database migrations (they apply by themselves when the API starts)
and changes the compose file. Review `Backend/prisma/migrations/` before approving.

## 2. Invitation emails

Until one of these is set up, nothing is emailed. Create Email still works: it
shows the Owner or Admin the invitation link once, to pass on, and **Credentials**
on a mailbox sets the person's password directly.

Both options use the same settings:

| Setting | Notes |
|---|---|
| `SYSTEM_MAIL_ENABLED` | `true` |
| `SYSTEM_MAIL_FROM` | An address the sending account is allowed to send as |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | The SMTP server |
| `MAIL_PROVIDER_USERNAME`, `MAIL_PROVIDER_PASSWORD` | The SMTP login. The system mailer uses these even while `MAIL_PROVIDER_ENABLED=false` |

- **Fast option:** the existing GoDaddy mailbox (`smtpout.secureserver.net`, port 465, secure `true`). It works today, but has sending limits and a mailbox login in the settings.
- **Planned option:** Amazon SES SMTP credentials. Verify the sending domain first.

## 3. Sending to outside addresses (optional, later)

Without it, mail between mailboxes inside Zoiko works and mail to outside
addresses fails with a clear `EXTERNAL_DELIVERY_NOT_CONFIGURED`.

| Setting | Value |
|---|---|
| `RELAY_ENABLED` | `true` |
| `RELAY_SMTP_HOST`, `RELAY_SMTP_PORT`, `RELAY_SMTP_SECURE` | The relay (Amazon SES or Brevo), usually port 587 |
| `RELAY_SMTP_USERNAME`, `RELAY_SMTP_PASSWORD` | The relay credentials |

Each sending domain must be verified with the relay.

## 4. Receiving from outside addresses (optional, later)

Only for domains whose DNS is on Cloudflare.

1. Generate a random secret of at least 32 characters and set it as `INBOUND_WEBHOOK_SECRET` on the server. Unset, the inbound endpoint answers 503.
2. Deploy the worker in `Backend/deploy/cloudflare-email-worker`: `npx wrangler deploy`, then `npx wrangler secret put INBOUND_WEBHOOK_SECRET` with the **same** value.
3. In `wrangler.toml`, `ZOIKO_INBOUND_URL` must be `https://api.zoikomail.com/api/v1/internal/inbound/messages`.
4. In Cloudflare, Email Routing for each domain: send the catch-all to this worker.

## 5. Stalwart (only if mailboxes should live on a mail server later)

A service account with the Admin role, and an API key under it with permission
to manage accounts and domains, stored in Secret Manager as `stalwart-api-token`.
Then set `STALWART_ENABLED=true` and `STALWART_BASE_URL`, and check
`/api/stalwart/health?probe=true` shows `managementCapability: true`. Needed for
Outlook and phone apps (IMAP) and for domains not on Cloudflare. See
`docs/DEPLOYMENT.md` for the staging checks before enabling deletion.

## 6. Security

- Rotate the production database password. It was pasted into a chat.
- Keep secrets in the server environment or Secret Manager, never in the repository.
- `INBOUND_WEBHOOK_SECRET`, `RELAY_SMTP_PASSWORD` and `MAIL_PROVIDER_PASSWORD` are credentials.

## 7. Check it worked

1. `curl -fsS https://api.zoikomail.com/api/ready` answers READY.
2. Create one test mailbox on a verified domain. Expect success and status "Invitation pending".
3. With email off, the result shows an invitation link to copy. With email on, the person receives an email.
4. Open the link, set a password, and sign in at the member sign-in.
