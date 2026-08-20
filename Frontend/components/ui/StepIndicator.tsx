"use client";

import { Check } from "lucide-react";

interface Step {
  label: string;
  description?: string;
}

interface StepIndicatorProps {
  steps: Step[];
  current: number;
}

export function StepIndicator({ steps, current }: StepIndicatorProps) {
  return (
    <div className="flex items-start gap-0">
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} className="flex flex-1 items-start">
            <div className="flex flex-col items-center">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition ${
                  done
                    ? "bg-[var(--ok)] text-white"
                    : active
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--s3)] text-[var(--ink3)]"
                }`}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <div className="mt-1.5 text-center">
                <div
                  className={`text-[11px] font-medium ${
                    active ? "text-[var(--accent-ink)]" : done ? "text-[var(--ok)]" : "text-[var(--ink3)]"
                  }`}
                >
                  {step.label}
                </div>
                {step.description && (
                  <div className="mt-0.5 text-[10px] text-[var(--ink3)]">{step.description}</div>
                )}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`mx-1 mt-3.5 h-0.5 flex-1 ${
                  done ? "bg-[var(--ok)]" : "bg-[var(--s3)]"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
