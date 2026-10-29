"use client";

import { useRef, useState } from "react";
import { CopyCheck, Download, FileUp, Upload, CheckCircle2, AlertTriangle } from "lucide-react";
import { useDuplicates, useImportContacts, useMergeContacts } from "@/lib/contacts-hooks";
import { listAllContacts, type ContactScope, type ImportResult } from "@/lib/contacts-api";
import { contactName, contactsToCsv, downloadText, parseContactsCsv, roleLine, type ParsedImport } from "@/lib/contact-format";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { Avatar } from "./ContactDetails";
import { errorText } from "./ContactDialog";

const card = "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--sh1)]";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const FIELD_LABEL: Record<string, string> = {
  firstName: "First name", lastName: "Last name", email: "Email", phone: "Phone",
  company: "Company", jobTitle: "Job title", notes: "Notes", tags: "Groups",
};

/** Import a CSV of contacts, or export them as one. */
export function ImportExportPanel({ onNotice }: { onNotice: (text: string, kind?: "ok" | "err") => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [exportScope, setExportScope] = useState<ContactScope>("mine");
  const [exporting, setExporting] = useState(false);
  const importer = useImportContacts();

  const pick = async (file: File | undefined) => {
    setResult(null);
    importer.reset();
    if (!file) return;
    setFileName(file.name);
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") {
      setParsed({ rows: [], columns: [], problem: "Choose a .csv file." });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setParsed({ rows: [], columns: [], problem: "The file is larger than 5 MB." });
      return;
    }
    const next = parseContactsCsv(await file.text());
    if (!next.problem && next.rows.length > 1000) next.problem = `The file has ${next.rows.length} contacts. Import at most 1,000 at a time.`;
    setParsed(next);
  };

  const runImport = () => {
    if (!parsed || parsed.problem) return;
    importer.mutate(parsed.rows, {
      onSuccess: (res) => {
        setResult(res);
        setParsed(null);
        setFileName(null);
        if (fileRef.current) fileRef.current.value = "";
        onNotice(`${res.created} contact${res.created === 1 ? "" : "s"} imported.`);
      },
    });
  };

  const runExport = async () => {
    setExporting(true);
    try {
      const contacts = await listAllContacts({ scope: exportScope, sort: "name" });
      if (contacts.length === 0) {
        onNotice("There are no contacts to export in that list.", "err");
        return;
      }
      downloadText(`zoiko-contacts-${new Date().toISOString().slice(0, 10)}.csv`, contactsToCsv(contacts));
      onNotice(`${contacts.length} contact${contacts.length === 1 ? "" : "s"} exported.`);
    } catch (error) {
      onNotice(errorText(error), "err");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="import-export">
      <section className={card} aria-labelledby="import-title">
        <div className="flex items-center gap-2">
          <Upload className="h-5 w-5 text-[var(--accent-ink)]" aria-hidden />
          <h2 id="import-title" className="text-[16px] font-semibold text-[var(--ink)]">Import contacts</h2>
        </div>
        <p className="mt-1.5 text-[13px] text-[var(--ink2)]">
          A CSV file whose first row names the columns. Email is required; First name, Last name, Phone, Company, Job title,
          Groups and Notes are read when present. Exports from Google Contacts and Outlook work as they are.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          id="contacts-import-file"
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <label
          htmlFor="contacts-import-file"
          className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--bstrong,var(--border))] bg-[var(--s2)] px-4 py-6 text-center text-[13px] text-[var(--ink2)] hover:border-[var(--accent)]"
        >
          <FileUp className="h-6 w-6 text-[var(--accent-ink)]" aria-hidden />
          {fileName ? <span className="font-medium text-[var(--ink)]">{fileName}</span> : <span>Choose a CSV file</span>}
          <span className="text-[11.5px] text-[var(--ink3)]">Up to 1,000 contacts, 5 MB</span>
        </label>

        {parsed?.problem && (
          <p role="alert" className="mt-3 flex items-start gap-2 text-[12.5px] text-[var(--crit)]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {parsed.problem}
          </p>
        )}
        {parsed && !parsed.problem && (
          <div className="mt-4" data-testid="import-preview">
            <p className="text-[13px] text-[var(--ink)]">
              <strong>{parsed.rows.length}</strong> row{parsed.rows.length === 1 ? "" : "s"} found. Columns read:{" "}
              {parsed.columns.map((c) => FIELD_LABEL[c]).join(", ")}.
            </p>
            <ul className="mt-2 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] text-[12.5px]">
              {parsed.rows.slice(0, 5).map((row, i) => (
                <li key={i} className="flex justify-between gap-3 px-3 py-2">
                  <span className="truncate text-[var(--ink)]">{[row.firstName, row.lastName].filter(Boolean).join(" ") || "—"}</span>
                  <span className="truncate text-[var(--ink3)]">{row.email || "no email"}</span>
                </li>
              ))}
            </ul>
            {parsed.rows.length > 5 && <p className="mt-1 text-[11.5px] text-[var(--ink3)]">and {parsed.rows.length - 5} more</p>}
            <div className="mt-3 flex gap-2">
              <button type="button" className="zoiko-btn pri" onClick={runImport} disabled={importer.isPending}>
                {importer.isPending ? "Importing…" : `Import ${parsed.rows.length} contact${parsed.rows.length === 1 ? "" : "s"}`}
              </button>
              <button
                type="button"
                className="zoiko-btn"
                disabled={importer.isPending}
                onClick={() => {
                  setParsed(null);
                  setFileName(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {importer.isError && (
          <p role="alert" className="mt-3 text-[12.5px] text-[var(--crit)]">{errorText(importer.error)}</p>
        )}
        {result && (
          <div className="mt-4 rounded-xl border border-[var(--border)] p-3" data-testid="import-result">
            <p className="flex items-center gap-2 text-[13px] font-medium text-[var(--ink)]">
              <CheckCircle2 className="h-4 w-4 text-[var(--ok)]" aria-hidden />
              {result.created} imported{result.skipped.length ? `, ${result.skipped.length} skipped` : ""}
            </p>
            {result.skipped.length > 0 && (
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-[12px] text-[var(--ink2)]">
                {result.skipped.map((s) => (
                  <li key={s.row}>
                    Line {s.row + 1}
                    {s.email ? ` (${s.email})` : ""}: {s.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className={card} aria-labelledby="export-title">
        <div className="flex items-center gap-2">
          <Download className="h-5 w-5 text-[var(--accent-ink)]" aria-hidden />
          <h2 id="export-title" className="text-[16px] font-semibold text-[var(--ink)]">Export contacts</h2>
        </div>
        <p className="mt-1.5 text-[13px] text-[var(--ink2)]">
          Download a CSV you can open in a spreadsheet or import elsewhere. Colleagues in the directory are not exported.
        </p>
        <label htmlFor="export-scope" className="mb-1 mt-4 block text-[12px] font-medium text-[var(--ink2)]">
          Which contacts
        </label>
        <select id="export-scope" className="zoiko-input" value={exportScope} onChange={(e) => setExportScope(e.target.value as ContactScope)}>
          <option value="mine">My contacts</option>
          <option value="all">All contacts I can see (mine and shared)</option>
          <option value="favorites">Favourites</option>
          <option value="shared">Shared contacts</option>
        </select>
        <button type="button" className="zoiko-btn pri mt-4" onClick={runExport} disabled={exporting}>
          <Download className="h-3.5 w-3.5" aria-hidden /> {exporting ? "Preparing…" : "Export CSV"}
        </button>
      </section>
    </div>
  );
}

/** Contacts of one's own that look like the same person, with a merge. */
export function DuplicatesPanel({ onNotice }: { onNotice: (text: string, kind?: "ok" | "err") => void }) {
  const duplicates = useDuplicates();
  const merge = useMergeContacts();
  const [keep, setKeep] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<{ key: string; keepId: string; mergeIds: string[]; name: string } | null>(null);

  if (duplicates.isLoading) {
    return (
      <div className={card}>
        <BrandLoader variant="compact" label="Looking for duplicates…" onRetry={() => void duplicates.refetch()} />
      </div>
    );
  }
  if (duplicates.isError) {
    return (
      <div className={`${card} text-[13px] text-[var(--crit)]`} role="alert">
        Could not check for duplicates.{" "}
        <button type="button" className="underline" onClick={() => duplicates.refetch()}>Try again</button>
      </div>
    );
  }
  const groups = duplicates.data ?? [];
  if (groups.length === 0) {
    return (
      <div className={`${card} flex flex-col items-center py-10 text-center`} data-testid="duplicates-empty">
        <CopyCheck className="h-10 w-10 text-[var(--ok)]" aria-hidden />
        <h2 className="mt-3 text-[16px] font-semibold text-[var(--ink)]">No duplicates found</h2>
        <p className="mt-1 max-w-sm text-[13px] text-[var(--ink2)]">None of your contacts share a name or a phone number.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="duplicates">
      <p className="text-[13px] text-[var(--ink2)]">
        {groups.length} possible duplicate{groups.length === 1 ? "" : "s"}. Choose the contact to keep: empty fields are filled
        from the others, their groups are combined, and the others are deleted.
      </p>
      {groups.map((group) => {
        const key = `${group.reason}:${group.key}`;
        const keepId = keep[key] ?? group.contacts[0]!.id;
        return (
          <section key={key} className={card} aria-label={`Possible duplicate: ${contactName(group.contacts[0]!)}`}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink3)]">
              {group.reason === "NAME" ? "Same name" : "Same phone number"}
            </p>
            <ul className="mt-2 space-y-2">
              {group.contacts.map((c) => (
                <li key={c.id}>
                  <label className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${keepId === c.id ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)] hover:bg-[var(--s2)]"}`}>
                    <input type="radio" name={key} checked={keepId === c.id} onChange={() => setKeep((k) => ({ ...k, [key]: c.id }))} className="accent-[var(--accent)]" />
                    <Avatar name={contactName(c)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-[var(--ink)]">{contactName(c)}</span>
                      <span className="block truncate text-[12px] text-[var(--ink3)]">
                        {[c.email, c.phone, roleLine(c.jobTitle, c.company)].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {keepId === c.id && <span className="text-[11.5px] font-medium text-[var(--accent-ink)]">Keep</span>}
                  </label>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="zoiko-btn pri mt-3"
              disabled={merge.isPending}
              onClick={() =>
                setConfirm({
                  key,
                  keepId,
                  mergeIds: group.contacts.filter((c) => c.id !== keepId).map((c) => c.id),
                  name: contactName(group.contacts.find((c) => c.id === keepId)!),
                })
              }
            >
              Merge {group.contacts.length} contacts
            </button>
          </section>
        );
      })}
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title="Merge these contacts?"
        message={`They become one contact, ${confirm?.name ?? ""}. The other ${confirm?.mergeIds.length === 1 ? "contact is" : "contacts are"} deleted. This cannot be undone.`}
        confirmLabel="Merge"
        variant="warning"
        loading={merge.isPending}
        onConfirm={() => {
          if (!confirm) return;
          merge.mutate(
            { keepId: confirm.keepId, mergeIds: confirm.mergeIds },
            {
              onSuccess: () => onNotice("Contacts merged."),
              onError: (error) => onNotice(errorText(error), "err"),
              onSettled: () => setConfirm(null),
            }
          );
        }}
      />
    </div>
  );
}
