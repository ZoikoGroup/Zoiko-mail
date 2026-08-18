"use client";

import { useState, useEffect, useRef } from "react";
import { Search, X } from "lucide-react";

interface SearchInputProps {
  placeholder?: string;
  value?: string;
  onChange: (value: string) => void;
  debounceMs?: number;
  className?: string;
}

export function SearchInput({
  placeholder = "Search…",
  value: controlledValue,
  onChange,
  debounceMs = 300,
  className = "",
}: SearchInputProps) {
  const [internal, setInternal] = useState(controlledValue ?? "");
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (controlledValue !== undefined) setInternal(controlledValue);
  }, [controlledValue]);

  const emit = (v: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(v), debounceMs);
  };

  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink3)]" />
      <input
        type="text"
        value={internal}
        onChange={(e) => {
          setInternal(e.target.value);
          emit(e.target.value);
        }}
        placeholder={placeholder}
        className="h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-8 pr-7 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
      />
      {internal && (
        <button
          onClick={() => {
            setInternal("");
            onChange("");
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--ink3)] hover:text-[var(--ink2)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
