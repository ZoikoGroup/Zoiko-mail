// Setup for vitest.stalwart-real.config.ts. The Stalwart client imports the
// app's config, which validates a few settings it never uses here; on a
// machine without Backend/.env they get harmless placeholders. Nothing
// connects to a database.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ||= "postgresql://unused:unused@127.0.0.1:1/unused";
process.env.JWT_ACCESS_SECRET ||= "stalwart-real-test-placeholder-access-secret";
process.env.JWT_REFRESH_SECRET ||= "stalwart-real-test-placeholder-refresh-secret";
// The test passes the role per client; a value in a developer's .env must not leak in.
process.env.STALWART_ACCOUNT_ROLE_ID = "";
