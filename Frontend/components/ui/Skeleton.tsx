"use client";

interface SkeletonProps {
  className?: string;
  variant?: "text" | "rect" | "circle";
}

export function Skeleton({ className = "", variant = "text" }: SkeletonProps) {
  const base = "animate-pulse rounded bg-[var(--s3)]";
  const variants = {
    text: "h-4 w-full",
    rect: "h-20 w-full rounded-lg",
    circle: "h-10 w-10 rounded-full",
  };
  return <div className={`${base} ${variants[variant]} ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="zoiko-card p-4 space-y-3">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-16" />
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
