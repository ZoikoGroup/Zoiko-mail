"use client";

import { useState } from "react";
import { FaEnvelope } from "react-icons/fa";
import { HiArrowLeft } from "react-icons/hi";
import { MdLockReset } from "react-icons/md";

import { ApiError } from "@/lib/api-client";
import { useForgotPassword } from "@/lib/auth-hooks";

import { FormInput } from "..";

interface ForgotPasswordFormProps {
  onBackToLogin: () => void;
  onSuccess: (email: string) => void;
}

export default function ForgotPasswordForm({
  onBackToLogin,
  onSuccess,
}: ForgotPasswordFormProps) {
  const forgotMutation = useForgotPassword();

  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  const validate = () => {
    if (!email.trim()) {
      setError("Email is required.");
      return false;
    }
    if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email)) {
      setError("Please enter a valid email.");
      return false;
    }
    setError("");
    return true;
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!validate()) return;

    forgotMutation.mutate(
      { email },
      {
        onSuccess: () => {
          // The backend always returns the same generic 200 (no user
          // enumeration), so we always advance to the reset screen and
          // carry the email forward for the reset request.
          onSuccess(email);
        },
        onError: (err) => {
          setError(
            err instanceof ApiError
              ? err.message
              : "Something went wrong. Please try again."
          );
        },
      }
    );
  };

  return (
    <>
      {/* ==========================================
          HEADER
      =========================================== */}

      <button
        onClick={onBackToLogin}
        className="mb-8 flex items-center gap-2 text-sm text-slate-500 transition hover:text-teal-600 dark:text-slate-400 dark:hover:text-teal-400"
      >
        <HiArrowLeft />
        Back to sign in
      </button>

      <div className="mb-10 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/40">
          <MdLockReset className="text-3xl text-teal-600 dark:text-teal-400" />
        </div>

        <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
          Forgot your password?
        </h2>

        <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
          Enter your account email and we&apos;ll send you a
          verification code to reset your password.
        </p>
      </div>

      {/* ==========================================
          FORM
      =========================================== */}

      <form onSubmit={onSubmit} className="space-y-6">
        <FormInput
          label="Email Address"
          type="email"
          placeholder="john@example.com"
          icon={FaEnvelope}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError("");
          }}
          error={error}
        />

        <button
          type="submit"
          disabled={forgotMutation.isPending}
          className="flex h-12 w-full items-center justify-center rounded-xl bg-teal-600 text-sm font-semibold text-white transition-all duration-300 hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {forgotMutation.isPending ? "Sending..." : "Send Reset Code"}
        </button>

        {/* ==========================================
            Privacy Notice
        =========================================== */}

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
          <p className="text-center text-sm leading-6 text-slate-600 dark:text-slate-300">
            For your security, we&apos;ll show the same confirmation
            whether or not an account exists for this email.
          </p>
        </div>

        {/* ==========================================
            Back to Login
        =========================================== */}

        <div className="text-center">
          <button
            type="button"
            onClick={onBackToLogin}
            className="text-sm font-semibold text-teal-600 transition hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300"
          >
            Remembered it? Sign in
          </button>
        </div>
      </form>
    </>
  );
}