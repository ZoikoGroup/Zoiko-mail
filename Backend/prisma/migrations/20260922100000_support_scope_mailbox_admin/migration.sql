-- A scope for the one write a support seat can make.
--
-- RBAC §11.1 allows "Reset mailbox setting (support)" only "if requested and
-- audited". Folding it into TENANT_DIAGNOSTICS would mean an owner who
-- approved a bounce investigation had also, without being told, approved
-- editing the mailbox that investigation looked at.
ALTER TYPE "SupportScope" ADD VALUE IF NOT EXISTS 'MAILBOX_ADMIN';
