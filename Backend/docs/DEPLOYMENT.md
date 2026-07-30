# Zoiko Mail backend deployment

## Required secrets

Create a deployment `.env` file that is never committed:

```env
POSTGRES_PASSWORD=replace-with-a-strong-database-password
JWT_ACCESS_SECRET=replace-with-at-least-32-random-characters
JWT_REFRESH_SECRET=replace-with-a-different-32-character-secret
OPERATIONS_KEY=replace-with-at-least-32-random-characters
CORS_ORIGIN=https://mail.example.com
API_PORT=5000
```

The application secrets must be different. Production startup rejects example or development secrets.

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
- `zoiko_storage` stores attachments and generated exports.

Back up both volumes. Restoring only one can leave attachment metadata and stored files inconsistent.

## Update

```sh
git pull
docker compose up --build -d
```

Only committed migrations are deployed. Never use `prisma db push` against production.

## Rollback

Deploy the previous application image. Prisma migrations are forward-only, so database rollback requires a reviewed recovery migration or a verified database backup.
