"use client";

import { useEffect, useMemo, useState } from "react";

import { ApiError } from "@/lib/api-client";
import { useSettings, useUpdateWorkspaceSettings } from "@/lib/admin-hooks";
import { useCan } from "@/lib/admin-capabilities";
import {
  Card,
  InlineError,
  LoadingRows,
  Notice,
  PageHeader,
  Pill,
  Row,
} from "@/components/admin/ui";

/** The screen shows "—" where a value is unset; it is not a value to save. */
const EMPTY_MARKER = "—";

export default function AdminSettingsPage() {
  const can = useCan();
  const { data: settings, isLoading, error } = useSettings();
  const save = useUpdateWorkspaceSettings();
  const canWrite = can("workspace.settings.write");

  /** Field values as stored, keyed by field key. */
  const saved = useMemo(() => {
    const map: Record<string, string> = {};
    for (const field of settings?.general ?? []) {
      map[field.key] = field.value === EMPTY_MARKER ? "" : field.value;
    }
    return map;
  }, [settings]);

  /** Field values as edited. Seeded from the server, and reseeded after a save. */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Reseed whenever the server view changes, which includes the refetch after
  // a save. That is what makes the page show what was actually stored rather
  // than what was typed — the server trims and lowercases, so they differ.
  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  const editable = (settings?.general ?? []).filter((f) => !f.readOnly);
  const dirtyKeys = editable
    .map((f) => f.key)
    .filter((key) => (draft[key] ?? "") !== (saved[key] ?? ""));
  const isDirty = dirtyKeys.length > 0;

  const onSave = () => {
    if (!isDirty) return;
    setSavedAt(null);
    save.mutate(
      // Only what changed. Sending every field would overwrite values this
      // screen does not own, and the endpoint rejects an empty patch anyway.
      Object.fromEntries(dirtyKeys.map((key) => [key, draft[key] ?? ""])),
      { onSuccess: () => setSavedAt(Date.now()) }
    );
  };

  const onRevert = () => {
    setDraft(saved);
    setSavedAt(null);
  };

  if (error) {
    return (
      <>
        <PageHeader title="Workspace settings" />
        <Card>
          <InlineError message={error.message} />
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

  const saveError =
    save.error instanceof ApiError
      ? save.error.message
      : save.error
        ? "Could not save. Please try again."
        : null;

  return (
    <>
      <PageHeader
        title="Workspace settings"
        subtitle="Tenant profile and the session policy in force"
        action={
          canWrite ? (
            <div className="flex items-center gap-2">
              {isDirty && (
                <button
                  type="button"
                  className="zoiko-btn"
                  onClick={onRevert}
                  disabled={save.isPending}
                >
                  Discard
                </button>
              )}
              <button
                type="button"
                className="zoiko-btn pri"
                onClick={onSave}
                // Disabled when nothing changed, so the button states plainly
                // whether there is anything to save.
                disabled={!isDirty || save.isPending}
              >
                {save.isPending ? "Saving…" : "Save changes"}
              </button>
            </div>
          ) : undefined
        }
      />

      {saveError && (
        <div className="mb-3">
          <InlineError message={saveError} />
        </div>
      )}

      {savedAt && !isDirty && !saveError && (
        <div className="mb-3">
          <Notice tone="ok">
            <b className="text-[var(--ok)]">Saved.</b> The values below are what
            the workspace now holds.
          </Notice>
        </div>
      )}

      <Card title="General" padded>
        {settings.general.map((field) => {
          const changed = !field.readOnly && dirtyKeys.includes(field.key);
          return (
            <div key={field.key} className="mb-3 max-w-[440px]">
              <label
                htmlFor={`setting-${field.key}`}
                className="font-mono-num mb-1 flex items-center gap-2 text-[9.5px] uppercase tracking-[0.1em] text-[var(--ink3)]"
              >
                {field.label}
                {changed && <Pill tone="warn">Unsaved</Pill>}
              </label>
              <input
                id={`setting-${field.key}`}
                // Controlled, so the value can be reset to what the server
                // actually stored. It was uncontrolled before, which is why
                // Save had nothing to read and a refetch changed nothing.
                value={field.readOnly ? field.value : (draft[field.key] ?? "")}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))
                }
                readOnly={field.readOnly || !canWrite}
                disabled={save.isPending}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--s2)] px-3 py-2 text-[12.6px] text-[var(--ink)] read-only:opacity-70 disabled:opacity-60"
              />
              {field.key === "timezone" && !field.readOnly && (
                <p className="mt-1 text-[10.5px] text-[var(--ink3)]">
                  An IANA name, such as Europe/London or Asia/Kolkata.
                </p>
              )}
              {field.key === "defaultDomain" && !field.readOnly && (
                <p className="mt-1 text-[10.5px] text-[var(--ink3)]">
                  A domain the workspace owns, such as acme.com. Leave blank to
                  clear it.
                </p>
              )}
            </div>
          );
        })}
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
