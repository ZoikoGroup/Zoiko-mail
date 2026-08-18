/**
 * Barrel for the admin primitives, so screens import from one place while each
 * component keeps its own file — the pattern components/auth already follows.
 */
export type { Tone } from "./types";
export { PageHeader } from "./PageHeader";
export { Pill } from "./Pill";
export { Card, Row } from "./Card";
export { StatTile } from "./StatTile";
export { Notice } from "./Notice";
export { TableWrap, Table, Th, Td } from "./DataTable";
export { EmptyState, LoadingRows, ErrorState } from "./States";
export { ToggleRow } from "./ToggleRow";
export { FilterChips } from "./FilterChips";
export { GuardRow } from "./GuardRow";
export { StaticNote } from "./StaticNote";
