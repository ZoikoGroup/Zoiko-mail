"use client";

import { ActionInbox } from "@/components/inbox/ActionInbox";

/**
 * The Admin's own commitments, rendered inside the admin shell.
 *
 * ActionInbox is already the commitments surface — the member route /inbox
 * renders the same component — so reusing it beats a fixture-backed admin copy
 * that would drift. Live data via useActions().
 *
 * Same reasoning as app/admin/inbox: reuse the component, keep the shell, so a
 * rail click never ejects an Admin into the member workspace.
 */
export default function AdminCommitmentsPage() {
  return <ActionInbox />;
}
