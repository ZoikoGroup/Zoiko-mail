'use client';

import { create } from 'zustand';
import { MAX_ATTEMPTS, type Outcome } from '@/constants/scenarios';
import { SEED_WORKSPACES } from '@/services/auth-service';
import type { Session } from '@/types/auth';
import { isListable, isSelectable, type Workspace } from '@/types/workspace';

interface AuthState {
  /* ── credentials ────────────────────────────── */
  email: string;
  password: string;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  /** True once both fields have content — the Proceed gate. */
  credentialsEntered: () => boolean;

  /* ── failed attempts ────────────────────────── */
  attempts: number;
  registerFailure: () => number;
  resetAttempts: () => void;
  attemptsRemaining: () => number;

  /**
   * The outcome of the most recent Proceed.
   *
   * The failure banner reads this rather than relying on being on a particular
   * route. A second rejection routes to the page already showing, which the
   * router treats as a no-op — without state the screen would not change and
   * the button would look broken.
   */
  lastOutcome: Outcome | null;
  setLastOutcome: (outcome: Outcome | null) => void;

  /* ── MFA ────────────────────────────────────── */
  otp: string[];
  setOtpDigit: (index: number, digit: string) => void;
  resetOtp: () => void;
  otpComplete: () => boolean;

  /* ── tenancy ────────────────────────────────── */
  workspaces: Workspace[];
  selectedWorkspaceId: string | null;
  selectWorkspace: (id: string) => void;
  /** Narrows the seed set to the memberships a scenario grants. */
  applyWorkspaceIds: (ids: string[]) => void;
  listableWorkspaces: () => Workspace[];
  selectableWorkspaces: () => Workspace[];

  /* ── identity ───────────────────────────────── */
  firstName: string;
  setFirstName: (value: string) => void;

  /* ── session ────────────────────────────────── */
  session: Session | null;
  setSession: (session: Session) => void;
  /**
   * Security §6 — a workspace switch clears cached tenant-scoped data.
   * Clearing the session here is what makes that visible in the UI.
   */
  clearSession: () => void;

  /** Returns to a clean sign-in, keeping the email for convenience. */
  resetForRetry: () => void;
}

const EMPTY_OTP = ['', '', '', '', '', ''];

export const useAuthStore = create<AuthState>((set, get) => ({
  email: '',
  password: '',
  setEmail: (value) => set({ email: value }),
  setPassword: (value) => set({ password: value }),
  credentialsEntered: () => get().email.trim().length > 0 && get().password.length > 0,

  attempts: 0,
  registerFailure: () => {
    const next = get().attempts + 1;
    set({ attempts: next });
    return next;
  },
  resetAttempts: () => set({ attempts: 0 }),
  attemptsRemaining: () => Math.max(0, MAX_ATTEMPTS - get().attempts),

  lastOutcome: null,
  setLastOutcome: (outcome) => set({ lastOutcome: outcome }),

  otp: [...EMPTY_OTP],
  setOtpDigit: (index, digit) =>
    set((state) => {
      const next = [...state.otp];
      next[index] = digit.replace(/\D/g, '').slice(-1);
      return { otp: next };
    }),
  resetOtp: () => set({ otp: [...EMPTY_OTP] }),
  otpComplete: () => get().otp.every((d) => d !== ''),

  workspaces: SEED_WORKSPACES,
  selectedWorkspaceId: SEED_WORKSPACES[0]?.id ?? null,
  selectWorkspace: (id) => set({ selectedWorkspaceId: id }),
  applyWorkspaceIds: (ids) => {
    const next = SEED_WORKSPACES.filter((w) => ids.includes(w.id));
    set({ workspaces: next, selectedWorkspaceId: next[0]?.id ?? null });
  },
  listableWorkspaces: () => get().workspaces.filter(isListable),
  selectableWorkspaces: () => get().workspaces.filter(isSelectable),

  firstName: 'Alex',
  setFirstName: (value) => set({ firstName: value }),

  session: null,
  setSession: (session) => set({ session }),
  clearSession: () => set({ session: null }),

  resetForRetry: () =>
    set({
      password: '',
      otp: [...EMPTY_OTP],
      session: null,
      lastOutcome: null,
      attempts: 0,
      workspaces: SEED_WORKSPACES,
      selectedWorkspaceId: SEED_WORKSPACES[0]?.id ?? null,
    }),
}));
