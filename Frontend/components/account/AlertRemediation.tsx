"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  REMEDIATION_LABEL,
  remediateSecurityAlert,
  type RemediationAction,
} from "@/lib/account-security-api";

/**
 * Containment buttons for one security alert (P1, ZMT-19): suspend the
 * forwarding rule it reports, remove the access it reports, or sign the
 * account out everywhere.
 *
 * Only what the server lists for this alert is offered, so a closed alert
 * shows nothing and an alert type gets only the actions that fit it. The
 * server still decides: an Admin asking to sign an Owner out is refused, and
 * the refusal is shown here rather than swallowed.
 */
export function AlertRemediation({ alertId, remediations }: { alertId: string; remediations?: RemediationAction[] }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState<RemediationAction | null>(null);

  const remediate = useMutation({
    mutationFn: (action: RemediationAction) => remediateSecurityAlert(alertId, action),
    onSettled: () => {
      // Both consoles keep their own list of the same alerts.
      void qc.invalidateQueries({ queryKey: ["security-alerts"] });
      void qc.invalidateQueries({ queryKey: ["owner", "security-alerts"] });
    },
  });

  if (!remediations?.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="alert-remediation">
      <span className="text-[11.5px] font-semibold text-[var(--ink3)]">Contain:</span>
      {remediations.map((action) => (
        <button
          key={action}
          type="button"
          className="zoiko-btn sm crit"
          disabled={remediate.isPending}
          onClick={() => setConfirming(action)}
        >
          {REMEDIATION_LABEL[action].label}
        </button>
      ))}
      {remediate.isError ? (
        <span className="text-[11.5px] text-[var(--crit)]" role="alert">
          {(remediate.error as Error).message}
        </span>
      ) : null}
      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          const action = confirming;
          setConfirming(null);
          if (action) remediate.mutate(action);
        }}
        title={confirming ? `${REMEDIATION_LABEL[confirming].label}?` : ""}
        message={confirming ? `${REMEDIATION_LABEL[confirming].confirm} The alert is closed and the action recorded in the audit log.` : ""}
        confirmLabel={confirming ? REMEDIATION_LABEL[confirming].label : "Confirm"}
        loading={remediate.isPending}
      />
    </div>
  );
}
