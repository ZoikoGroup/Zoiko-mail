-- Contacts page: favourites, workspace-shared contacts, and where a contact came from.

-- CreateEnum
CREATE TYPE "ContactVisibility" AS ENUM ('PERSONAL', 'SHARED');

-- CreateEnum
CREATE TYPE "ContactSource" AS ENUM ('MANUAL', 'IMPORT', 'MAIL');

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "is_favorite" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source" "ContactSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "visibility" "ContactVisibility" NOT NULL DEFAULT 'PERSONAL';

-- CreateIndex
CREATE INDEX "contacts_tenant_id_visibility_idx" ON "contacts"("tenant_id", "visibility");
