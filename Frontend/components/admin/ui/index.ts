/**
 * Barrel for the admin primitives, so screens import from one place while each
 * component keeps its own file — the pattern components/auth already follows.
 *
 * ── Relationship to components/ui ──────────────────────────────────────────
 * components/ui holds the shared primitives every workspace uses. This
 * directory holds only what is specific to the admin workspace. Nothing here
 * may re-implement something there; where the two overlapped, this barrel now
 * either delegates or renames:
 *
 *   PageHeader   delegates to components/ui/PageHeader — it was the same
 *                component under a second prop vocabulary.
 *   InlineEmpty  compact in-card variant; components/ui/EmptyState is the
 *                full-page one. Different densities, not duplicates.
 *   InlineError  the same distinction against components/ui/ErrorState.
 *   Table/Th/Td  low-level table primitives. components/ui/DataTable is a
 *                configured generic table with sorting and pagination — when
 *                the admin tables need those, adopt it rather than growing
 *                these.
 *
 * Check components/ui before adding anything here. Two components sharing one
 * name is what caused this note to exist.
 */
export type { Tone } from "./types";
export { PageHeader } from "./PageHeader";
export { Pill } from "./Pill";
export { Card, Row } from "./Card";
export { StatTile } from "./StatTile";
export { Notice } from "./Notice";
export { TableWrap, Table, Th, Td } from "./Table";
export { InlineEmpty, LoadingRows, InlineError } from "./States";
export { ToggleRow } from "./ToggleRow";
export { FilterChips } from "./FilterChips";
export { GuardRow } from "./GuardRow";
export { StaticNote } from "./StaticNote";
