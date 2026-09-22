-- A scope for reading inside a mailbox, asked for and approved on its own.
--
-- RBAC §2 gives Support "Read private user mailbox" only through a grant, and
-- Security §4 calls it an exceptional path. Folding it into
-- TENANT_DIAGNOSTICS would mean an owner approving a bounce investigation had
-- also, without being told, approved reading their staff's mail.
ALTER TYPE "SupportScope" ADD VALUE IF NOT EXISTS 'MAIL_CONTENT';
