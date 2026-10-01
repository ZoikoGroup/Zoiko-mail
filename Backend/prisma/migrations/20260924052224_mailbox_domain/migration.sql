-- AlterTable
ALTER TABLE "mailboxes" ADD COLUMN     "domain_id" UUID;

-- AddForeignKey
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_domain_id_fkey" FOREIGN KEY ("domain_id") REFERENCES "mail_domains"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
