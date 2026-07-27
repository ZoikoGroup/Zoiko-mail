# Zoiko Mail API testing

Start the API with `npm run dev`, then open `http://localhost:5000/api/docs` for interactive Swagger documentation.

Use `GET /api/health` for process liveness and `GET /api/ready` for PostgreSQL and storage readiness.

For Postman, import both JSON files from this directory and select **Zoiko Mail Local**. Run **Authentication / Login** first; its test script stores the access token, refresh token, tenant ID, and membership ID automatically.

The seeded owner login is `owner@zoiko.test` with password `Password123!` and tenant ID `00000000-0000-4000-8000-000000000001`.

The collection saves IDs from create requests so later requests can reuse `messageId`, `threadId`, `labelId`, `policyId`, `jobId`, and other variables.

Recommended order:

1. Run **Authentication / Login**.
2. Create and activate **Policies / Create Sending Policy**.
3. Create a draft in **Mail / Create Draft**.
4. Run the mail, message, label, lifecycle, notification and audit requests as required.

Set `operationsKey` in the selected Postman environment before calling **System / Metrics**.

Permanent tenant deletion is intentionally marked **DANGEROUS**. Use it only with a disposable tenant after testing request, approval and cancellation first.
