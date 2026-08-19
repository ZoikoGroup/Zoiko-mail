"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import {
  login,
  register,
  logout,
  logoutAll,
  changePassword,
  getMe,
  verifyOtp,
  resendOtp,
  createWorkspace,
  forgotPassword,
  resetPassword,

  type LoginInput,
  type RegisterInput,
  type ChangePasswordInput,

  type VerifyOtpInput,
  type ResendOtpInput,
  type CreateWorkspaceInput,
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
        // Platform-scoped session (staff with platformRole but no tenant).
        href = "/platform-console";
      } else if (data.state === "SIGNED_IN") {
        // Regular user — use the membership role from the backend session.
        const role = data.membership?.role;
        href = resolveWorkspaceHref(role);
        // } else if (data.state === "NO_WORKSPACE") {
        //   href = "/";
        // } else if (data.state === "WORKSPACE_SELECTION") {
        //   href = "/";
        // } else {
        //   href = "/login";
        // }

      } else if (data.state === "WORKSPACE_SELECTION") {
        // Stash the workspaces + selection token so /select-workspace can render
        // the picker and call /auth/select-workspace without asking for the
        // password again. sessionStorage (not localStorage) — selection token
        // expires in 15 min and this isn't a real session.
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
        // Account-level blocks — inform-only page, no workspace context needed.
        href = `/auth-status?state=${data.state}`;
      } else if (
        data.state === "MEMBERSHIP_SUSPENDED" ||
        data.state === "WORKSPACE_SUSPENDED" ||
        data.state === "WORKSPACE_DELETING"
      ) {
        // All three carry a single workspace object with a `name` field.
        const workspaceName = encodeURIComponent(data.workspace?.name ?? "");
        href = `/auth-status?state=${data.state}&workspace=${workspaceName}`;
      } else if (data.state === "EMAIL_VERIFICATION_REQUIRED") {
        // Backend requires OTP verification before session issuance. Stash the
        // pending token + email in sessionStorage so /verify-email can pick them
        // up. sessionStorage (not localStorage) because these are short-lived
        // and not a real session — they die with the browser tab.
        if (typeof window !== "undefined") {
          sessionStorage.setItem("zoiko.pending_token", data.pendingToken ?? "");
          sessionStorage.setItem("zoiko.pending_email", data.user?.email ?? "");
        }
        href = "/verify-email";
      } else {
        href = "/login";
      }

      router.replace(href);
    },
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

      router.replace(resolveWorkspaceHref(data?.membership?.role));
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
