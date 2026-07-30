import { create } from "zustand";
import type { CommitmentType } from "./types";

// Zustand holds CLIENT-ONLY state: things that live in this browser and
// are NOT owned by the server. Server data (the commitments list) lives
// in TanStack Query, never here. Keep IDs and UI flags here, not records.

export type FilterKey = "needs_review" | "all" | CommitmentType;

interface UiState {
  activeTenantId: string;
  activeTenantName: string;
  selectedId: string | null;
  filter: FilterKey;
  setSelected: (id: string | null) => void;
  setFilter: (f: FilterKey) => void;
  setTenant: (id: string, name: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeTenantId: "tenant_meridian",
  activeTenantName: "Meridian Ops",
  selectedId: "cmt_1",
  filter: "needs_review",
  setSelected: (id) => set({ selectedId: id }),
  setFilter: (filter) => set({ filter }),
  setTenant: (activeTenantId, activeTenantName) =>
    set({ activeTenantId, activeTenantName }),
}));
