-- CreateEnum
CREATE TYPE "IdentityProvider" AS ENUM ('GOOGLE', 'MICROSOFT');

-- AlterTable
ALTER TABLE "app_users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "user_identities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" "IdentityProvider" NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_identities_user_id_idx" ON "user_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_provider_provider_user_id_key" ON "user_identities"("provider", "provider_user_id");

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
