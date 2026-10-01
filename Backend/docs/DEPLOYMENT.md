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
