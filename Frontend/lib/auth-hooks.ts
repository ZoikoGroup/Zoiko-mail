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
import { isLoggedIn } from "./auth-storage";
import { resolveWorkspaceHref } from "./workspace";

// Server state (the logged-in user) lives in TanStack Query, keyed by ['me'].
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    enabled: isLoggedIn(), // don't call /auth/me if we have no token
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
      } else if (data.state === "NO_WORKSPACE") {
        href = "/";
      } else if (data.state === "WORKSPACE_SELECTION") {
        // Multiple workspaces — show workspace chooser (not implemented here;
        // the backend already returned the options).
        href = "/";
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
