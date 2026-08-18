"use client";

import { useSettings } from "@/lib/admin-hooks";
import { useCan } from "@/lib/admin-capabilities";
import {
  Card,
  ErrorState,
  LoadingRows,
  Notice,
  PageHeader,
  Pill,
  Row,
  StaticNote,
} from "@/components/admin/ui";

export default function AdminSettingsPage() {
  const can = useCan();
  const { data: settings, isLoading, error } = useSettings();
  const canWrite = can("workspace.settings.write");

  if (error) {
    return (
      <>
        <PageHeader title="Workspace settings" />
        <Card>
          <ErrorState message={error.message} />
        </Card>
      </>
    );
  }

  if (isLoading || !settings) {
    return (
      <>
        <PageHeader title="Workspace settings" />
        <Card>
          <LoadingRows rows={4} />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Workspace settings"
        subtitle="Tenant profile and the session policy in force"
        action={
          canWrite ? (
            <button type="button" className="zoiko-btn pri">
              Save changes
            </button>
          ) : undefined
        }
      />

      <StaticNote>PATCH /tenants/current exists; default domain and quota are new fields</StaticNote>

      <Card title="General" padded>
        {settings.general.map((field) => (
          <div key={field.key} className="mb-3 max-w-[440px]">
            <label
              htmlFor={`setting-${field.key}`}
              className="font-mono-num mb-1 block text-[9.5px] uppercase tracking-[0.1em] text-[var(--ink3)]"
            >
              {field.label}
            </label>
            <input
              id={`setting-${field.key}`}
              defaultValue={field.value}
              readOnly={!canWrite}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--s2)] px-3 py-2 text-[12.6px] text-[var(--ink)] read-only:opacity-70"
            />
          </div>
        ))}
      </Card>

      {/*
        Read-only on purpose. These values are enforced by the session layer, not
        set here — showing them as editable would imply control the screen does
        not have, and a displayed timeout that isn't enforced is worse than none.
      */}
      <Card title="Sessions" badge={<Pill tone="nu">Read-only</Pill>}>
        {settings.sessions.map((field) => (
          <Row
            key={field.key}
            title={field.label}
            detail={field.value}
            right={<Pill tone="nu">Enforced</Pill>}
          />
        ))}
      </Card>

      {!canWrite && (
        <Notice tone="info">
          <b className="text-[var(--ai)]">You can read these settings but not change them.</b>{" "}
          Changing workspace settings needs the <code>workspace.settings.write</code> capability.
        </Notice>
      )}
    </>
  );
}
