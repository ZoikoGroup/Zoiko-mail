-- CreateTable
CREATE TABLE "task_followers" (
    "commitment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_followers_pkey" PRIMARY KEY ("commitment_id","user_id")
);

-- CreateIndex
CREATE INDEX "task_followers_tenant_id_user_id_idx" ON "task_followers"("tenant_id", "user_id");

-- AddForeignKey
ALTER TABLE "task_followers" ADD CONSTRAINT "task_followers_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_followers" ADD CONSTRAINT "task_followers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_followers" ADD CONSTRAINT "task_followers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same row-level isolation as commitments themselves.
ALTER TABLE "task_followers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_followers" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "task_followers_tenant_isolation" ON "task_followers";
CREATE POLICY "task_followers_tenant_isolation" ON "task_followers"
  USING (zoiko_cross_tenant() OR tenant_id = zoiko_current_tenant())
  WITH CHECK (zoiko_cross_tenant() OR tenant_id = zoiko_current_tenant());

GRANT SELECT, INSERT, UPDATE, DELETE ON "task_followers" TO zoiko_app;
