'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Zap } from 'lucide-react';
import { AuthCard, AuthHero } from '@/components/layout/AuthCard';
import { Button } from '@/components/ui/Button';
import { Note } from '@/components/ui/Card';
import { SessionSummary } from './components/SessionSummary';
import { ROUTES } from '@/constants/routes';
import { authService } from '@/services/auth-service';
import { trackAudit, trackFunnel } from '@/services/telemetry';
import { useAuthStore } from '@/store/auth-store';
import { displayRole } from '@/utils/format';

/**
 * STATE 6 · Signed in
 * Feature 3 · Security §6 session binding · Audit §6.1 login
 */
export default function WelcomePage() {
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const setSession = useAuthStore((s) => s.setSession);
  const selectedId = useAuthStore((s) => s.selectedWorkspaceId);
  const workspaces = useAuthStore((s) => s.workspaces);

  const workspace = workspaces.find((w) => w.id === selectedId) ?? workspaces[0];

  // Deep-linking straight here is legitimate for review, so the session is
  // issued on arrival if one does not already exist.
  useEffect(() => {
    if (session) return;
    let cancelled = false;

    void authService.selectWorkspace(selectedId ?? workspace.id).then((issued) => {
      if (cancelled) return;
      setSession(issued);
      trackFunnel('session_issued');
      trackAudit('login', { tenantId: issued.tenantId });
    });

    return () => {
      cancelled = true;
    };
  }, [session, selectedId, workspace.id, setSession]);

  return (
    <AuthCard>
      <AuthHero
        tone="ok"
        icon={<CheckCircle2 aria-hidden className="h-[22px] w-[22px]" strokeWidth={1.7} />}
        title="Welcome back, Alex"
      >
        {workspace.name} · signed in as {displayRole(session?.role ?? workspace.role)}
      </AuthHero>

      {session && <SessionSummary session={session} />}

      <Button variant="primary" onClick={() => router.push(ROUTES.expired)}>
        <Zap aria-hidden className="h-3.5 w-3.5" strokeWidth={1.9} />
        Go to Action Center
      </Button>

      <Note>
        Audit <span className="text-ok">login</span> written. Privileged sessions use a shorter idle timeout —
        Security §6.
      </Note>
    </AuthCard>
  );
}
