"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import {
  login,
  googleLogin,
  register,
  logout,
  logoutAll,
  changePassword,
  getMe,
  verifyOtp,
  resendOtp,
  createWorkspace,
  joinWorkspace,
  forgotPassword,
  resetPassword,

  type LoginInput,
  type RegisterInput,
  type ChangePasswordInput,

  type VerifyOtpInput,
  type ResendOtpInput,
  type CreateWorkspaceInput,
  type JoinWorkspaceInput,
  type ForgotPasswordInput,
  type ResetPasswordInput,
} from "./auth-api";
import { getPlatformToken, isLoggedIn } from "./auth-storage";
// import { resolveWorkspaceHref } from "./workspace";
import { AuthResponse, GoogleLoginInput, loginWithGoogle } from "./auth-api";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { resolveWorkspaceHref } from "./workspace";

// Server state (the logged-in user) lives in TanStack Query, keyed by ['me'].
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    // enabled: isLoggedIn(), 
    enabled: isLoggedIn() && !getPlatformToken(), // don't call /auth/me for anonymous or staff sessions
    retry: false,
    staleTime: 60_000,
  });
}

/**
 * Maps a backend AuthState onto a destination. Shared by password login and
 * Google login — both return the identical state union, so duplicating this
 * would guarantee the two paths drift apart.
 *
 * `signedInHref` overrides where a signed-in user lands. No caller sets it
 * today: every sign-in, password or Google, routes on the role the backend
 * assigned, so authenticating one way cannot reach a workspace the other
 * would not. Kept as a parameter because the alternative — a second copy of
 * this dispatch for one differing line — is what let the two paths drift
 * before, sending Google sign-ins to a dead end on NO_WORKSPACE.
 */
/**
 * The workspace a session was opened for, as the server reported it.
 *
 * Two response shapes have to be read: /auth/login flattens the session onto
 * the top level, while /auth/select-workspace returns the state verbatim with
 * the session one level down. The string check disambiguates a genuine name
 * collision — on suspended states `workspace` is an object describing the
 * tenant, not a scope.
 */
export function sessionWorkspace(data: AuthResponse): string | undefined {
  const nested = (data as { session?: { workspace?: unknown } }).session?.workspace;
  if (typeof nested === "string") return nested;
  return typeof data.workspace === "string" ? data.workspace : undefined;
}

export function routeAuthState(
  data: AuthResponse,
  router: AppRouterInstance,
  opts?: { signedInHref?: string }
): void {
  let href: string;

  if (data.state === "STAFF_CONSOLE") {
    href = "/support";
  } else if (data.state === "SIGNED_IN") {
    // Routed on the workspace the server bound this session to, not on the
    // role. They usually agree, but a Google sign-in is always MEMBER-scoped
    // however senior the account is — routing on the role there would open
    // the owner console, which is exactly what the scope withholds.
    href = opts?.signedInHref ?? resolveWorkspaceHref(sessionWorkspace(data));
  } else if (data.state === "WORKSPACE_SELECTION") {
    if (typeof window !== "undefined") {
      sessionStorage.setItem("zoiko.selection_token", data.selectionToken ?? "");
      sessionStorage.setItem("zoiko.selection_workspaces", JSON.stringify(data.workspaces ?? []));
    }
    href = "/select-workspace";
  } else if (data.state === "ACCOUNT_SUSPENDED" || data.state === "ACCOUNT_DISABLED") {
    href = `/auth-status?state=${data.state}`;
  } else if (
    data.state === "MEMBERSHIP_SUSPENDED" ||
    data.state === "WORKSPACE_SUSPENDED" ||
    data.state === "WORKSPACE_DELETING"
  ) {
    href = `/auth-status?state=${data.state}&workspace=${encodeURIComponent(data.workspace?.name ?? "")}`;
  } else if (data.state === "EMAIL_VERIFICATION_REQUIRED") {
    if (typeof window !== "undefined") {
      sessionStorage.setItem("zoiko.pending_token", data.pendingToken ?? "");
      sessionStorage.setItem("zoiko.pending_email", data.user?.email ?? "");
    }
    href = "/verify-email";
  } else if (data.state === "INVITATION_PENDING") {
    if (typeof window !== "undefined") {
      sessionStorage.setItem("zoiko.invite_pending_token", data.pendingToken ?? "");
      sessionStorage.setItem("zoiko.invite_pending_list", JSON.stringify(data.invitations ?? []));
      sessionStorage.removeItem("pendingInvitationToken");
    }
    const names = (data.invitations ?? []).map((w: { name: string }) => w.name).join(",");
    href = `/auth-status?state=INVITATION_PENDING${names ? `&invitations=${encodeURIComponent(names)}` : ""}`;
  } else if (data.state === "NO_WORKSPACE") {
    // Every brand-new Google signup lands here: the account exists and is
    // verified, but it belongs to no workspace yet, so there is nothing to
    // sign in to until one is created. The backend attaches a pending token
    // for exactly that, and /auth/create-workspace is the only thing that
    // accepts it.
    //
    // Not /owner/onboarding: that sits behind ProtectedRoute, which requires a
    // session this state does not have yet, so it bounces straight back to
    // /login. Not /login either — the sign-in happens there, so replacing the
    // same URL re-renders without remounting and a step on that page would
    // never appear. /create-workspace is its own route for both reasons.
    if (typeof window !== "undefined") {
      sessionStorage.setItem("zoiko.workspace_token", data.pendingToken ?? "");
      sessionStorage.setItem("zoiko.workspace_email", data.user?.email ?? "");
    }
    href = "/create-workspace";
  } else {
    href = "/login";
  }

  router.replace(href);
}

export function useLogin() {
  const qc = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (input: LoginInput) => login(input),
    onSuccess: async (data) => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      routeAuthState(data, router);
    },
  });
}

// export function useGoogleLogin() {
//   const qc = useQueryClient();
//   const router = useRouter();

//   return useMutation({
//     mutationFn: (input: GoogleLoginInput) => loginWithGoogle(input),
//     onSuccess: async (data) => {
//       await qc.invalidateQueries({ queryKey: ["me"] });
//       routeAuthState(data, router);
//     },
//   });
// }

// export function useRegister() {
//   const qc = useQueryClient();
//   const router = useRouter();

//   return useMutation({
//     mutationFn: (input: RegisterInput) => register(input),

//     onSuccess: async () => {
//       await qc.invalidateQueries({
//         queryKey: ["me"],
//       });

//       router.replace("/");
//     },
//   });
// }

/**
 * Google sign-in.
 *
 * Routes exactly as a password sign-in does, on the role the backend assigned
 * to the workspace being entered: Owner to the owner console, Admin to the
 * admin console, everyone else to their mailbox. Proving identity with Google
 * grants no different destination and no different authority than proving it
 * with a password.
 *
 * A user in more than one workspace resolves to WORKSPACE_SELECTION here just
 * as they would with a password, so Google cannot skip the pick or carry a
 * session into a second workspace.
 *
 * Routing goes through routeAuthState rather than a local copy: this hook
 * previously carried its own dispatch, which sent NO_WORKSPACE to /login and
 * stranded every brand-new Google account back on the form it came from.
 */
export function useGoogleLogin() {
  const qc = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: ({ idToken }: { idToken: string }) => googleLogin(idToken),

    onSuccess: async (data) => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      routeAuthState(data, router);
    },
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: (input: RegisterInput) =>
      register(input),
  });
}

export function useVerifyOtp() {
  return useMutation({
    mutationFn: (input: VerifyOtpInput) =>
      verifyOtp(input),
  });
}

export function useResendOtp() {
  return useMutation({
    mutationFn: (input: ResendOtpInput) =>
      resendOtp(input),
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (
      input: CreateWorkspaceInput
    ) => createWorkspace(input),

    onSuccess: async (data) => {
      await qc.invalidateQueries({
        queryKey: ["me"],
      });

      // New workspace always needs onboarding
      router.replace("/owner/onboarding");
    },
  });
}

// End of the invited-registration flow: accept the pending invitation and
// land in the joined workspace under the invited role (ADMIN → /admin,
// MEMBER → /inbox). The backend decides the role; never the client.
export function useJoinWorkspace() {
  const qc = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (input: JoinWorkspaceInput) => joinWorkspace(input),

    onSuccess: async (data) => {
      await qc.invalidateQueries({
        queryKey: ["me"],
      });

      router.replace(resolveWorkspaceHref(data.membership?.role));
    },
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (input: ForgotPasswordInput) =>
      forgotPassword(input),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (input: ResetPasswordInput) =>
      resetPassword(input),
  });
}

export function useChangePassword() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: ChangePasswordInput) =>
      changePassword(input),

    onSuccess: async () => {
      await qc.invalidateQueries({
        queryKey: ["me"],
      });
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: () => logout(),
    onSettled: () => {
      qc.clear();
      router.replace("/login");
    },
  });
}
export function useLogoutAll() {
  const qc = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: logoutAll,

    onSettled: () => {
      qc.clear();
      router.replace("/login");
    },
  });
}
