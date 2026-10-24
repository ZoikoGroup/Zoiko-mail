"use client";

import { useRef, useState, type RefObject } from "react";

const KEY_STEP = 8;
const KEY_STEP_LARGE = 40;

/**
 * A draggable vertical divider that sets the width of the pane before it.
 *
 * While dragging, the width is written straight to that pane's CSS variable on each
 * animation frame — a list of a hundred messages does not re-render per pixel
 * — and committed once, when the drag ends. The same divider is a keyboard
 * control (a focusable separator: arrows, Shift+arrows, Home, End), and a
 * double-click puts the layout back to Standard.
 */
export function PaneDivider({
  label,
  paneRef,
  cssVar,
  min,
  max,
  onCommit,
  onReset,
  testId,
}: {
  /** What it resizes, for assistive technology: "Resize message list". */
  label: string;
  /** The pane whose width this divider sets. */
  paneRef: RefObject<HTMLElement>;
  /** The CSS variable the pane's desktop width reads — set while dragging,
   * so phone layouts (which ignore it) are never touched. */
  cssVar: string;
  min: number;
  /** The largest width right now; may depend on the window. */
  max: () => number;
  onCommit: (width: number) => void;
  onReset: () => void;
  testId?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const [, setTick] = useState(0); // re-render for aria-valuenow after a keyboard step
  const frame = useRef<number | null>(null);
  const drag = useRef<{ startX: number; startWidth: number; width: number } | null>(null);

  const current = () => Math.round(paneRef.current?.getBoundingClientRect().width ?? min);
  const clamp = (value: number) => Math.round(Math.min(Math.max(min, max()), Math.max(min, value)));

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !paneRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startWidth = current();
    drag.current = { startX: event.clientX, startWidth, width: startWidth };
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    state.width = clamp(state.startWidth + event.clientX - state.startX);
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (paneRef.current && drag.current) paneRef.current.style.setProperty(cssVar, `${drag.current.width}px`);
    });
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    drag.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    // A click without movement is not a resize; leave the layout as it was.
    if (Math.abs(state.width - state.startWidth) >= 1) onCommit(state.width);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = current() - step;
    else if (event.key === "ArrowRight") next = current() + step;
    else if (event.key === "Home") next = min;
    else if (event.key === "End") next = max();
    if (next === null) return;
    event.preventDefault();
    onCommit(clamp(next));
    setTick((t) => t + 1);
  };

  const now = current();
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={Math.max(min, Math.round(max()))}
      aria-valuenow={now}
      aria-valuetext={`${now} pixels`}
      tabIndex={0}
      title={`${label} — drag, or use the arrow keys. Double-click for standard size.`}
      data-testid={testId}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className="group relative z-10 -mx-1 hidden w-2 shrink-0 cursor-col-resize touch-none select-none focus:outline-none lg:block"
    >
      {/* The visible line: hairline at rest, accent while hovered, focused or dragged. */}
      <span
        aria-hidden
        className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-[background-color,width] duration-150 ${
          dragging
            ? "w-[3px] bg-[var(--accent)]"
            : "bg-transparent group-hover:w-[3px] group-hover:bg-[var(--accent)] group-focus-visible:w-[3px] group-focus-visible:bg-[var(--accent)]"
        }`}
      />
      {/* A grip, so the divider can be found without hunting for it. */}
      <span
        aria-hidden
        className={`absolute left-1/2 top-1/2 flex h-8 w-1.5 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-[3px] rounded-full transition-opacity ${
          dragging ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
        }`}
      >
        <span className="h-[3px] w-[3px] rounded-full bg-[var(--accent)]" />
        <span className="h-[3px] w-[3px] rounded-full bg-[var(--accent)]" />
        <span className="h-[3px] w-[3px] rounded-full bg-[var(--accent)]" />
      </span>
    </div>
  );
}
