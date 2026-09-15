/*
  Warnings:

  - You are about to drop the column `access_token` on the `connected_accounts` table. All the data in the column will be lost.
  - You are about to drop the column `refresh_token` on the `connected_accounts` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "connected_accounts" DROP COLUMN "access_token",
DROP COLUMN "refresh_token",
ADD COLUMN     "token_secret_ref" TEXT;
