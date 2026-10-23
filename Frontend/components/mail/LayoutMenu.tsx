"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Columns3, Check } from "lucide-react";
import { FOLDER_PANE, LIST_PANE, usePaneLayout, type PaneMode } from "@/lib/pane-layout";

/**
 * The top bar's Layout menu: Standard size (the default panes) or Custom size
 * (sliders for the folder pane and message list, also set by dragging the
 * dividers between panes). Desktop only — phones show one pane at a time.
 */
export function LayoutMenu() {
  const layout = usePaneLayout();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!layout) return null;
  const custom = layout.mode === "custom";

  const option = (mode: PaneMode, title: string, hint: string) => {
    const selected = layout.mode === mode;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={() => layout.setMode(mode)}
        className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
          selected ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)] hover:bg-[var(--s2)]"
        }`}
      >
        <span
          className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
            selected ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--ink3)]"
          }`}
          aria-hidden
        >
          {selected && <Check className="h-3 w-3" />}
        </span>
        <span>
          <span className="block text-[13px] font-semibold text-[var(--ink)]">{title}</span>
          <span className="block text-[11.5px] text-[var(--ink3)]">{hint}</span>
        </span>
      </button>
    );
  };

  const slider = (label: string, value: number, min: number, max: number, onChange: (v: number) => void, testId: string) => (
    <div>
      <div className="flex items-center justify-between text-[12px]">
        <label htmlFor={`${id}-${testId}`} className="font-medium text-[var(--ink2)]">
          {label}
        </label>
        <output htmlFor={`${id}-${testId}`} className="tabular-nums text-[var(--ink3)]">
          {value}px
        </output>
      </div>
      <input
        id={`${id}-${testId}`}
        data-testid={testId}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={!custom}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 w-full accent-[var(--accent)] disabled:opacity-40"
      />
    </div>
  );

  return (
    <div className="relative hidden lg:block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Layout"
        title="Layout — pane sizes"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--ink2)] transition hover:bg-[var(--s2)] hover:text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <Columns3 className="h-[18px] w-[18px]" aria-hidden />
        {custom && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--accent)]" aria-hidden />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Layout"
          className="absolute right-0 top-full z-30 mt-2 w-72 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--sh3)]"
        >
          <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ink3)]">Pane size</p>
          <div role="radiogroup" aria-label="Pane size" className="space-y-1.5">
            {option("standard", "Standard size", "The default layout")}
            {option("custom", "Custom size", "Set the widths below, or drag the dividers")}
          </div>

          <div className={`mt-3 space-y-3 rounded-lg bg-[var(--s2)] p-3 ${custom ? "" : "opacity-70"}`}>
            {slider("Folder pane", layout.folderWidth, FOLDER_PANE.min, FOLDER_PANE.max, layout.setFolderWidth, "folder-width")}
            {slider("Message list", layout.listWidth, LIST_PANE.min, LIST_PANE.max, layout.setListWidth, "list-width")}
            {!custom && <p className="text-[11px] text-[var(--ink3)]">Choose Custom size to change these.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
