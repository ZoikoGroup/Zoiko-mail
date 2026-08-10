"use client";

import { useEffect, useState } from "react";
import { HiArrowLeft } from "react-icons/hi";
import { MdLockReset } from "react-icons/md";

import { ApiError } from "@/lib/api-client";
import { useResetPassword, useForgotPassword } from "@/lib/auth-hooks";

import { PasswordInput } from "..";
import OtpInput from "../inputs/OtpInput";

interface ResetPasswordFormProps {
  email: string;
  onBackToLogin: () => void;
  onSuccess: () => void;
}

export default function ResetPasswordForm({
  email,
  onBackToLogin,
  onSuccess,
}: ResetPasswordFormProps) {
  const resetMutation = useResetPassword();
  const resendMutation = useForgotPassword();

  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(60);

  useEffect(() => {
    if (seconds === 0) return;
    const timer = setInterval(() => setSeconds((prev) => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [seconds]);

  const validate = () => {
    if (code.length !== 6) {
      setError("Please enter the 6-digit reset code.");
      return false;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return false;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return false;
    }
    setError("");
    return true;
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!validate()) return;

    resetMutation.mutate(
      { email, code, newPassword },
      {
        onSuccess: () => {
          // Password changed and all sessions revoked server-side.
          // Send the user back to sign in with their new password.
          onSuccess();
        },
        onError: (err) => {
          setError(
            err instanceof ApiError
              ? err.message
              : "Unable to reset your password. Please try again."
          );
        },
      }
    );
  };

  const resend = () => {
    resendMutation.mutate(
      { email },
      {
        onSuccess: () => setSeconds(60),
        onError: (err) => {
          setError(
            err instanceof ApiError
              ? err.message
              : "Unable to resend the code."
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
          Reset your password
        </h2>

        <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
          Enter the 6-digit code we sent to
        </p>

        <p className="mt-2 font-semibold text-slate-900 dark:text-white">
          {email}
        </p>
      </div>

      {/* ==========================================
          FORM
      =========================================== */}

      <form onSubmit={onSubmit} className="space-y-6">
        <div className="space-y-2">
          <label className="block text-center text-sm font-medium text-slate-700 dark:text-slate-300">
            Verification Code
          </label>

          <OtpInput
            value={code}
            onChange={(value) => {
              setCode(value);
              if (error) setError("");
            }}
          />
        </div>

        <PasswordInput
          label="New Password"
          placeholder="Enter new password"
          value={newPassword}
          onChange={(e) => {
            setNewPassword(e.target.value);
            if (error) setError("");
          }}
        />

        <PasswordInput
          label="Confirm New Password"
          placeholder="Re-enter new password"
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            if (error) setError("");
          }}
        />

        {/* ==========================================
            Error Message
        =========================================== */}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {/* ==========================================
            Reset Button
        =========================================== */}

        <button
          type="submit"
          disabled={resetMutation.isPending}
          className="flex h-12 w-full items-center justify-center rounded-xl bg-teal-600 text-sm font-semibold text-white transition-all duration-300 hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {resetMutation.isPending ? "Resetting..." : "Reset Password"}
        </button>

        {/* ==========================================
            Resend Section
        =========================================== */}

        <div className="text-center">
          {seconds > 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Didn&apos;t receive the code?{" "}
              <span className="font-semibold text-teal-600 dark:text-teal-400">
                Resend in {seconds}s
              </span>
            </p>
          ) : (
            <button
              type="button"
              onClick={resend}
              disabled={resendMutation.isPending}
              className="text-sm font-semibold text-teal-600 transition hover:text-teal-700 disabled:opacity-60 dark:text-teal-400 dark:hover:text-teal-300"
            >
              {resendMutation.isPending ? "Sending..." : "Resend Code"}
            </button>
          )}
        </div>
      </form>
    </>
  );
}