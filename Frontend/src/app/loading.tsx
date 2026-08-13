/**
 * Route-level loading state.
 *
 * A skeleton that matches the final card layout rather than a spinner, so
 * the page does not appear to jump when content arrives.
 */
export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-[376px] animate-fade-in flex-col gap-4" aria-busy aria-live="polite">
      <span className="sr-only">Loading</span>

      <div className="flex flex-col gap-2">
        <div className="h-[26px] w-[62%] animate-pulse2 rounded bg-s3" />
        <div className="h-[15px] w-[85%] animate-pulse2 rounded bg-s3" />
      </div>

      <div className="mt-2 flex flex-col gap-1.5">
        <div className="h-[10px] w-[74px] animate-pulse2 rounded bg-s3" />
        <div className="h-[44px] w-full animate-pulse2 rounded-field bg-s3" />
      </div>

      <div className="h-[44px] w-full animate-pulse2 rounded-field bg-s3" />

      <div className="mt-5 flex items-center gap-3 border-t border-border pt-[15px]">
        <div className="h-[11px] w-10 animate-pulse2 rounded bg-s3" />
        <div className="h-[11px] w-12 animate-pulse2 rounded bg-s3" />
        <div className="h-[11px] w-14 animate-pulse2 rounded bg-s3" />
      </div>
    </div>
  );
}
