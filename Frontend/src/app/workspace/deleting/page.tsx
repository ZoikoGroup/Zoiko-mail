import { Hourglass } from 'lucide-react';
import { AuthCard, AuthHero } from '@/components/layout/AuthCard';
import { Button } from '@/components/ui/Button';
import { DetailList, Note, Panel } from '@/components/ui/Card';

export const metadata = { title: 'Workspace being deleted · Zoiko Mail' };

const TIMELINE = [
  { label: 'Access disabled', value: '30 Jul' },
  { label: 'Export available until', value: '6 Aug' },
  { label: 'Hard delete completes', value: '29 Aug' },
] as const;

/**
 * STATE 14 · Workspace deleting
 * Feature 6 · Data Model §6.1 (Tenant.status = deleted_pending) · §11
 *
 * Distinct from suspension: the workspace is on its way out, the export window
 * is still open, and the 30-day hard-delete SLA is running. The timeline is the
 * point — a user in this state needs to know how long they have to retrieve
 * their data.
 */
export default function WorkspaceDeletingPage() {
  return (
    <AuthCard>
      <AuthHero
        tone="crit"
        icon={<Hourglass aria-hidden className="h-[22px] w-[22px]" strokeWidth={1.7} />}
        title="Acme Corp is being deleted"
      >
        Deletion was authorised on 30 July by the workspace Owner.
      </AuthHero>

      <Panel label="Timeline">
        <DetailList rows={TIMELINE} />
      </Panel>

      <Button variant="primary">Download my export</Button>

      <Note>Tenant.status = deleted_pending · 30-day hard-delete SLA — Data Model §6.1 · §11.</Note>
    </AuthCard>
  );
}
