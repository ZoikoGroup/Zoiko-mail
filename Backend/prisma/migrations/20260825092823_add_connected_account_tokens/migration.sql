-- AlterTable
ALTER TABLE "connected_accounts" ADD COLUMN     "access_token" TEXT,
ADD COLUMN     "refresh_token" TEXT,
ADD COLUMN     "token_expires_at" TIMESTAMP(3);
