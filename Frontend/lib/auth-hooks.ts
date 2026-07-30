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
  type LoginInput,
  type RegisterInput,
  type ChangePasswordInput,
} from "./auth-api";

import { isLoggedIn } from "./auth-storage";

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
// export function useLogin() {
//   const qc = useQueryClient();
//   const router = useRouter();
//   return useMutation({
//     mutationFn: (input: LoginInput) => login(input),
//     onSuccess: async () => {
//       await qc.invalidateQueries({ queryKey: ["me"] }); 
//       router.replace("/"); 
//     },
//   });
// }
export function useLogin() {
  const qc = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (input: LoginInput) => login(input),

    onSuccess: async () => {
      await qc.invalidateQueries({
        queryKey: ["me"],
      });

      router.replace("/");
    },
  });
}

export function useRegister() {
  const qc = useQueryClient();
  const router = useRouter();

  return useMutation({
    mutationFn: (input: RegisterInput) => register(input),

    onSuccess: async () => {
      await qc.invalidateQueries({
        queryKey: ["me"],
      });

      router.replace("/");
    },
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