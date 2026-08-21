/**
 * Admin workspace primitive. Composes the tokens and .zoiko-* classes that
 * already exist in app/globals.css rather than introducing a second styling
 * vocabulary.
 */

/* ── filter chips ──────────────────────────────────────────────────────── */

export function FilterChips({
  options,
  active,
  onChange,
}: {
  options: string[];
  active: string;
  onChange: (option: string) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === active}
          onClick={() => onChange(option)}
          className={`rounded-full border px-3 py-1 text-[11.5px] font-semibold transition ${
            option === active
              ? "border-[var(--ink)] bg-[var(--ink)] text-[var(--ground)]"
              : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink2)] hover:border-[var(--bstrong)]"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
