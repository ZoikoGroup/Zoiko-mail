-- DropIndex
DROP INDEX "email_messages_status_scheduled_at_idx";

-- DropIndex
DROP INDEX "mailbox_messages_tenant_id_mailbox_id_is_starred_created_at_idx";

-- RenameIndex
ALTER INDEX "integration_links_tenant_id_product_source_type_source_id_resou" RENAME TO "integration_links_tenant_id_product_source_type_source_id_r_key";

-- RenameIndex
ALTER INDEX "support_access_grants_tenant_id_support_membership_id_expires_a" RENAME TO "support_access_grants_tenant_id_support_membership_id_expir_idx";
