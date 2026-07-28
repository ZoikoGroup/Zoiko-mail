# Zoiko Mail Backend

Zoiko Mail is a secure multi-tenant mail backend built as a modular monolith with Express.js, TypeScript, PostgreSQL and Prisma.

The project currently provides JWT authentication, tenant and membership management, internal mail delivery, message threads, attachments, mailbox organization, policies, audit logging, background jobs, lifecycle controls and operational monitoring.

Provider-dependent integrations such as external SMTP delivery, Gmail/Microsoft synchronization, live DNS verification and AI model execution are intentionally not included yet.

## Technolo

- Node.js 22
- Express.js 5
- TypeScript
- PostgreSQL
- Prisma ORM
- JWT access and rotating refresh tokens
- Zod validation
- Vitest and Supertest
- Docker and Docker Compose

## Architecture

The application is a modular monolith. Each business area owns its routes, validation and service logic while using one deployment and one PostgreSQL database.

```text
src/
  config/                 Environment, Prisma, logging, OpenAPI and metrics
  common/
    errors/               Application errors and error codes
    middleware/           Authentication, tenant context, roles and validation
    types/                Shared TypeScript types
    utils/                Password, token and response helpers
  modules/
    auth/                 Registration, login, refresh, logout and sessions
    tenant/               Tenant settings and status
    user/                 User profile and account security
    membership/           Roles, invitations and membership lifecycle
    audit/                Tenant-scoped audit records
    policy/               Sending, retention, deletion, AI and abuse policies
    mail/                 Drafts, sending, attachments and mailbox operations
    message/              Message search and conversation threads
    domain/               Hosted and custom-domain metadata
    action/               Commitments and action tracking
    notification/         Alerts and digest jobs
    integration/          Provider-independent product links
    job/                  Background-job processing
    lifecycle/            Exports and protected tenant deletion
    support/              Temporary audited support diagnostics
  routes/                 API router
  app.ts                  Express application
  server.ts               HTTP server, workers and graceful shutdown
prisma/
  migrations/             Versioned PostgreSQL migrations
  schema.prisma           Database schema
  seed.ts                 Development seed data
tests/                    Integration and security tests
docs/                     API testing and deployment guides
```

## Implemented features

### Authentication and security

- User registration and multi-tenant login
- Short-lived JWT access tokens
- Rotating refresh tokens with reuse prevention
- Password hashing with bcrypt
- Change password and revoke sessions
- Active user, tenant and membership checks
- OWNER, ADMIN, MEMBER and restricted SUPPORT roles
- Request IDs, Helmet, CORS, compression and rate limiting
- Central validation and error responses

The verified JWT supplies `tenantId`, `membershipId` and `role`. Tenant IDs from request bodies or query parameters are never trusted for authorization.

### Mail and messages

- Draft creation, update and deletion
- Internal tenant mail delivery
- External-recipient queue state without provider delivery
- Reply, reply-all and forward drafts
- Secure BCC handling
- Attachments with type, size and mailbox quota checks
- Inbox, Sent, Drafts, Archive and Trash folders
- Read/unread and star/unstar operations
- Bulk mailbox actions
- Permanent Trash cleanup
- Custom mailbox-private labels
- Searchable messages and conversation threads
- Scheduled delivery with retry and duplicate-send protection
- Sending policies, rate limits and mailbox suspension

### Administration and compliance

- Tenant settings and profile management
- Membership invitations, role changes and suspension
- Append-only tenant audit events
- Policy versioning and activation
- Preview-first retention cleanup
- Data export generation and secure download
- Three-stage tenant deletion with final name confirmation
- Durable hashed deletion receipts
- Temporary scoped SUPPORT diagnostics

### Operations

- PostgreSQL and storage readiness checks
- Prometheus-compatible metrics
- Background job and scheduled-mail workers
- Structured logs with secret redaction
- Graceful shutdown
- OpenAPI and Swagger documentation
- Docker Compose deployment
- GitHub Actions CI with PostgreSQL

## Requirements

For local development:

- Node.js 22 or newer
- npm
- PostgreSQL 15 or newer

Docker Desktop can be used instead of installing PostgreSQL directly.

## Environment setup

Copy `.env.example` to `.env` and replace the example values.

Important variables:

```env
NODE_ENV=development
PORT=5000
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@127.0.0.1:5432/zoiko_mail?schema=public

JWT_ACCESS_SECRET=use-at-least-32-random-characters
JWT_REFRESH_SECRET=use-a-different-32-character-secret
OPERATIONS_KEY=use-another-32-character-random-secret

CORS_ORIGIN=http://localhost:3000
```

Do not commit `.env`. Production startup rejects known example and development secrets.

## Local installation

```sh
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

The default API address is:

```text
http://localhost:5000
```

## Useful commands

```sh
npm run dev                 # Start development server with file watching
npm run build               # Compile TypeScript into dist/
npm start                   # Start the compiled application
npm run type-check          # Validate TypeScript without output
npm test                    # Run all integration tests
npm run test:watch          # Run tests in watch mode
npm run db:generate         # Generate Prisma Client
npm run db:migrate          # Create/apply a development migration
npm run db:migrate:deploy   # Apply committed production migrations
npm run db:seed             # Insert development seed data
npm run db:studio           # Open Prisma Studio
```

Never use `prisma db push` against production.

## API access

Swagger UI:

```text
GET /api/docs/
```

OpenAPI JSON:

```text
GET /api/docs.json
```

Core authentication endpoints:

```text
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
GET  /api/v1/auth/me
```

Protected endpoints require:

```http
Authorization: Bearer ACCESS_TOKEN
```

Operational metrics require a separate key:

```http
GET /api/metrics
x-operations-key: OPERATIONS_KEY
```

See [docs/API_TESTING.md](docs/API_TESTING.md) for Postman instructions.

## Health checks

```text
GET /api/health
GET /api/ready
```

`/api/health` confirms that the process is running. `/api/ready` checks PostgreSQL, attachment storage and export storage.

## Testing

Tests use a separate PostgreSQL database. Configure `TEST_DATABASE_URL`, or use a `DATABASE_URL` database name ending in `_test`.

```env
TEST_DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@127.0.0.1:5432/zoiko_mail_test?schema=public
```

Run:

```sh
npm test
```

The test suite covers authentication, refresh-token rotation, tenant isolation, roles, invitations, policies, mail, messages, attachments, labels, scheduled delivery, audits, support access, exports, retention and deletion safety.

## Docker deployment

Create a deployment `.env` with strong secrets, then run:

```sh
docker compose up --build -d
docker compose ps
```

The API container:

- waits for PostgreSQL;
- applies committed migrations;
- runs as a non-root user;
- exposes readiness health checks;
- stores PostgreSQL and uploaded files in named volumes.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for deployment, backups, updates and rollback guidance.

## Current provider boundaries

The backend currently supports provider-independent workflows. The following require future external services or provider credentials:

- Sending mail to external internet recipients
- Receiving external email
- Gmail and Microsoft 365 synchronization
- Live DNS and custom-domain verification
- AI drafting and summarization execution
- Hosted object storage for production-scale attachments and exports

Internal tenant mail, authentication, policies, lifecycle controls and all other implemented modules work without purchasing these services.

## License

Private project owned by Zoiko Group.
