"use client";

import { useState } from "react";
import Link from "next/link";
import { FaEnvelope } from "react-icons/fa";

import { ApiError } from "@/lib/api-client";
import { useLogin, useGoogleLogin } from "@/lib/auth-hooks";

import {
  FormInput,
  PasswordInput,
  GoogleSignInButton,
} from "@/components/auth";
import GoogleOtpStep from "@/components/auth/GoogleOtpStep";

interface LoginFormProps {
  onRegister: () => void;
  onForgotPassword: () => void;
}

type FormErrors = {
  email?: string;
  password?: string;
};

export default function LoginForm({
  onRegister,
  onForgotPassword,
}: LoginFormProps) {
  const loginMutation = useLogin();
  const googleLoginMutation = useGoogleLogin();

  // Set when Google sign-in comes back asking for a code. Holding it here
  // keeps the whole two-leg flow on one screen, so a refresh mid-flow lands
  // back on a clean login rather than a half-authenticated dead end.
  const [googleOtp, setGoogleOtp] = useState<{ pendingToken: string; sentTo: string } | null>(null);

  const [rememberMe, setRememberMe] = useState(false);

  const [formData, setFormData] = useState({
    email: "",
    password: "",
    tenantId: "",
  });

  const [errors, setErrors] =
    useState<FormErrors>({});

  const handleChange = (
    field: keyof typeof formData,
    value: string
  ) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));

    setErrors((prev) => ({
      ...prev,
      [field]: undefined,
    }));
  };

  const validate = () => {
    const newErrors: FormErrors = {};

    if (!formData.email.trim()) {
      newErrors.email = "Email is required.";
    } else if (
      !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(
        formData.email
      )
    ) {
      newErrors.email =
        "Please enter a valid email.";
    }

    if (!formData.password) {
      newErrors.password =
        "Password is required.";
    }

    setErrors(newErrors);

    return Object.keys(newErrors).length === 0;
  };

  const onSubmit = (
    e: React.FormEvent<HTMLFormElement>
  ) => {
    e.preventDefault();

    if (!validate()) return;

    loginMutation.mutate({
      email: formData.email,
      password: formData.password,
      tenantId:
        formData.tenantId || undefined,
    });
  };

  const errorMessage =
    loginMutation.error instanceof ApiError
      ? loginMutation.error.message
      : loginMutation.error
      ? "Something went wrong."
      : googleLoginMutation.error instanceof ApiError
      ? googleLoginMutation.error.message
      : googleLoginMutation.error
      ? "Something went wrong."
      : null;

  if (googleOtp) {
    return (
      <GoogleOtpStep
        pendingToken={googleOtp.pendingToken}
        sentTo={googleOtp.sentTo}
        onCancel={() => setGoogleOtp(null)}
      />
    );
  }

  return (
    <>
      {/* ================================================
          HEADER
      ================================================= */}

      <div className="mb-5 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
          Welcome Back
        </h2>

        <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
          Sign in to continue to your
          Zoiko Mail workspace.
        </p>
      </div>

      {/* ================================================
          FORM
      ================================================= */}

      <GoogleSignInButton
        onSuccess={(idToken) =>
          googleLoginMutation.mutate(
            { idToken },
            {
              onSuccess: (data) => {
                if (data.state === "OTP_REQUIRED") {
                  setGoogleOtp({
            pendingToken: data.pendingToken,
            // Falls back to the typed address so the screen always names
            // somewhere, even if an older API omits the echo.
            sentTo: data.sentTo ?? data.user?.email ?? formData.email,
          });
                }
              },
            }
          )
        }
        disabled={loginMutation.isPending || googleLoginMutation.isPending}
      />

      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-200 dark:border-slate-700" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-white px-2 text-slate-500 dark:bg-slate-950 dark:text-slate-400">or</span>
        </div>
      </div>

      <form
        onSubmit={onSubmit}
        className="space-y-3"
      >
        <FormInput
          label="Email Address"
          type="email"
          placeholder="john@example.com"
          icon={FaEnvelope}
          value={formData.email}
          onChange={(e) =>
            handleChange(
              "email",
              e.target.value
            )
          }
          error={errors.email}
        />

        <PasswordInput
          label="Password"
          placeholder="Enter your password"
          value={formData.password}
          onChange={(e) =>
            handleChange(
              "password",
              e.target.value
            )
          }
          error={errors.password}
        />
                {/* =====================================================
            Remember Me / Forgot Password
        ====================================================== */}

        <div className="flex items-center justify-between gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) =>
                setRememberMe(e.target.checked)
              }
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />

            <span>Remember me</span>
          </label>

          <button
            type="button"
            onClick={onForgotPassword}
            className="text-sm font-medium text-teal-600 transition hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300"
          >
            Forgot password?
          </button>
        </div>

        {/* =====================================================
            Error Message
        ====================================================== */}

        {errorMessage && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {errorMessage}
          </div>
        )}

        {/* =====================================================
            Login Button
        ====================================================== */}

        <button
          type="submit"
          disabled={loginMutation.isPending || googleLoginMutation.isPending}
          className="flex h-12 w-full items-center justify-center rounded-xl bg-teal-600 text-sm font-semibold text-white transition-all duration-300 hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loginMutation.isPending
            ? "Signing In..."
            : "Sign In"}
        </button>

        {/* =====================================================
            Register Link
        ====================================================== */}

        <div className="text-center">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Don&apos;t have an account?{" "}
            <button
              type="button"
              onClick={onRegister}
              className="font-semibold text-teal-600 transition-colors hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300"
            >
              Create one
            </button>
          </p>
        </div>

        {/* =====================================================
            Terms
        ====================================================== */}

        <div className="text-center text-xs leading-6 text-slate-500 dark:text-slate-500">
          By continuing you agree to our{" "}
          <Link
            href="/terms"
            className="font-medium text-teal-600 hover:underline dark:text-teal-400"
          >
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link
            href="/privacy"
            className="font-medium text-teal-600 hover:underline dark:text-teal-400"
          >
            Privacy Policy
          </Link>
          .
        </div>
      </form>
    </>
  );
}
