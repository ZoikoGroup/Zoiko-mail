"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import {
  login,
  googleLogin,
  googleVerifyOtp,
  googleResendOtp,
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

export function useLogin() {
  const qc = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (input: LoginInput) => login(input),

    onSuccess: async (data) => {
      await qc.invalidateQueries({
        queryKey: ["me"],
      });

      // Determine redirect based on backend auth state — the backend is the
      // source of truth for role, never localStorage or email.
      let href: string;

      if (data.state === "STAFF_CONSOLE") {
        href = "/support";
      } else if (data.state === "SIGNED_IN") {
        const role = data.membership?.role;
        href = resolveWorkspaceHref(role);
      } else if (data.state === "WORKSPACE_SELECTION") {
        if (typeof window !== "undefined") {
          sessionStorage.setItem(
            "zoiko.selection_token",
            data.selectionToken ?? ""
          );
          sessionStorage.setItem(
            "zoiko.selection_workspaces",
            JSON.stringify(data.workspaces ?? [])
          );
        }
        href = "/select-workspace";
      } else if (
        data.state === "ACCOUNT_SUSPENDED" ||
        data.state === "ACCOUNT_DISABLED"
      ) {
        href = `/auth-status?state=${data.state}`;
      } else if (
        data.state === "MEMBERSHIP_SUSPENDED" ||
        data.state === "WORKSPACE_SUSPENDED" ||
        data.state === "WORKSPACE_DELETING"
      ) {
        const workspaceName = encodeURIComponent(data.workspace?.name ?? "");
        href = `/auth-status?state=${data.state}&workspace=${workspaceName}`;
      } else if (data.state === "EMAIL_VERIFICATION_REQUIRED") {
        if (typeof window !== "undefined") {
          sessionStorage.setItem("zoiko.pending_token", data.pendingToken ?? "");
          sessionStorage.setItem("zoiko.pending_email", data.user?.email ?? "");
        }
        href = "/verify-email";
      } else if (data.state === "INVITATION_PENDING") {
        // No tenant session exists yet, so acceptance happens on the
        // status screen using the backend-issued pending token (same
        // mechanism as the post-registration join flow).
        if (typeof window !== "undefined") {
          sessionStorage.setItem("zoiko.invite_pending_token", data.pendingToken ?? "");
          sessionStorage.setItem(
            "zoiko.invite_pending_list",
            JSON.stringify(data.invitations ?? [])
          );
          sessionStorage.removeItem("pendingInvitationToken");
        }
        const names = (data.invitations ?? []).map((w: { name: string }) => w.name).join(",");
        href = `/auth-status?state=INVITATION_PENDING${names ? `&invitations=${encodeURIComponent(names)}` : ""}`;
      } else {
        href = "/login";
      }

      if (data.state === "NO_WORKSPACE") {
        router.replace("/login");
        return;
      }

      router.replace(href);
    },
  });
}

/**
 * Second leg of Google sign-in.
 *
 * Shares useGoogleLogin's redirect handling, because a verified code produces
 * exactly the same AuthState a password login does, so the destination logic
 * must be the same rather than a parallel copy that can drift.
 */
export function useGoogleVerifyOtp() {
  const qc = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: ({ pendingToken, code }: { pendingToken: string; code: string }) =>
      googleVerifyOtp(pendingToken, code),

    onSuccess: async (data) => {
      await qc.invalidateQueries({ queryKey: ["me"] });

      let href: string;
      if (data.state === "STAFF_CONSOLE") {
        href = "/support";
      } else if (data.state === "SIGNED_IN") {
        // Google sign-in still lands in the user's own role-resolved
        // workspace (SUPPORT → /tenant-support, ADMIN → /admin, etc.).
        const role = data.membership?.role;
        href = resolveWorkspaceHref(role);
      } else if (data.state === "WORKSPACE_SELECTION") {
        if (typeof window !== "undefined") {
          sessionStorage.setItem("zoiko.selection_token", data.selectionToken ?? "");
          sessionStorage.setItem(
            "zoiko.selection_workspaces",
            JSON.stringify(data.workspaces ?? [])
          );
        }
        href = "/select-workspace";
      } else if (
        data.state === "ACCOUNT_SUSPENDED" ||
        data.state === "ACCOUNT_DISABLED"
      ) {
        href = `/auth-status?state=${data.state}`;
      } else {
        href = "/login";
      }

      router.replace(href);
    },
  });
}

/** Re-request the sign-in code. Bounded server-side by a cooldown and hourly cap. */
export function useGoogleResendOtp() {
  return useMutation({
    mutationFn: (pendingToken: string) => googleResendOtp(pendingToken),
  });
}

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

export function useGoogleLogin() {
  const qc = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: ({ idToken }: { idToken: string }) => googleLogin(idToken),

    onSuccess: async (data) => {
      await qc.invalidateQueries({
        queryKey: ["me"],
      });

      let href: string;

      if (data.state === "STAFF_CONSOLE") {
        href = "/support";
      } else if (data.state === "SIGNED_IN") {
        // Google sign-in lands in the user's role-resolved workspace.
        const role = data.membership?.role;
        href = resolveWorkspaceHref(role);
      } else if (data.state === "WORKSPACE_SELECTION") {
        if (typeof window !== "undefined") {
          sessionStorage.setItem(
            "zoiko.selection_token",
            data.selectionToken ?? ""
          );
          sessionStorage.setItem(
            "zoiko.selection_workspaces",
            JSON.stringify(data.workspaces ?? [])
          );
        }
        href = "/select-workspace";
      } else if (
        data.state === "ACCOUNT_SUSPENDED" ||
        data.state === "ACCOUNT_DISABLED"
      ) {
        href = `/auth-status?state=${data.state}`;
      } else if (
        data.state === "MEMBERSHIP_SUSPENDED" ||
        data.state === "WORKSPACE_SUSPENDED" ||
        data.state === "WORKSPACE_DELETING"
      ) {
        const workspaceName = encodeURIComponent(data.workspace?.name ?? "");
        href = `/auth-status?state=${data.state}&workspace=${workspaceName}`;
      } else if (data.state === "EMAIL_VERIFICATION_REQUIRED") {
        if (typeof window !== "undefined") {
          sessionStorage.setItem("zoiko.pending_token", data.pendingToken ?? "");
          sessionStorage.setItem("zoiko.pending_email", data.user?.email ?? "");
        }
        href = "/verify-email";
      } else if (data.state === "INVITATION_PENDING") {
        if (typeof window !== "undefined") {
          sessionStorage.setItem("zoiko.invite_pending_token", data.pendingToken ?? "");
          sessionStorage.setItem(
            "zoiko.invite_pending_list",
            JSON.stringify(data.invitations ?? [])
          );
          sessionStorage.removeItem("pendingInvitationToken");
        }
        const names = (data.invitations ?? []).map((w: { name: string }) => w.name).join(",");
        href = `/auth-status?state=INVITATION_PENDING${names ? `&invitations=${encodeURIComponent(names)}` : ""}`;
      } else {
        href = "/login";
      }

      if (data.state === "NO_WORKSPACE") {
        router.replace("/login");
        return;
      }

      router.replace(href);
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
