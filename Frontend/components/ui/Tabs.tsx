"use client";

export interface Tab {
  id: string;
  label: string;
  count?: number;
}

interface TabsProps {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}

export function Tabs({ tabs, active, onChange, className = "" }: TabsProps) {
  return (
    <div className={`flex gap-1 border-b border-[var(--border)] ${className}`}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`relative px-3 py-2 text-sm font-medium transition ${
            active === tab.id
              ? "text-[var(--accent-ink)]"
              : "text-[var(--ink3)] hover:text-[var(--ink2)]"
          }`}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className="ml-1.5 font-mono-num text-[10px] text-[var(--ink3)]">
              {tab.count}
            </span>
          )}
          {active === tab.id && (
            <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[var(--accent)]" />
          )}
        </button>
      ))}
    </div>
  );
}
