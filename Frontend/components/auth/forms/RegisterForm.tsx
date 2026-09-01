"use client";

import { useState } from "react";

import { FaBuilding, FaEnvelope, FaUser } from "react-icons/fa";

import { ApiError } from "@/lib/api-client";
import { useRegister, useGoogleLogin } from "@/lib/auth-hooks";

import { FormInput, PasswordInput, GoogleSignInButton } from "..";

type FormErrors = {
  displayName?: string;
  email?: string;
  tenantName?: string;
  password?: string;
  confirmPassword?: string;
};

interface RegisterFormProps {
  onBackToLogin: () => void;
  onSuccess: (
    pendingToken: string,
    email: string,
    tenantName: string,
    planCode: string
  ) => void;
}

export default function RegisterForm({
  onBackToLogin,
  onSuccess,
}: RegisterFormProps) {
  const registerMutation = useRegister();
  const googleLoginMutation = useGoogleLogin();

  const [formData, setFormData] = useState({
    displayName: "",
    email: "",
    tenantName: "",
    planCode: "starter",
    password: "",
    confirmPassword: "",
  });

  const [errors, setErrors] = useState<FormErrors>({});

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

    if (!formData.displayName.trim()) {
      newErrors.displayName = "Display name is required.";
    }

    if (!formData.email.trim()) {
      newErrors.email = "Email is required.";
    } else if (
      !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+.[A-Z]{2,}$/i.test(formData.email)
    ) {
      newErrors.email = "Enter a valid email address.";
    }

    // Workspace name is optional: invited users join an existing workspace
    // instead of creating one, so they won't have a name to type.
    if (formData.tenantName.trim().length > 120) {
      newErrors.tenantName = "Workspace name must be at most 120 characters.";
    }

    if (!formData.password) {
      newErrors.password = "Password is required.";
    } else if (formData.password.length < 8) {
      newErrors.password =
        "Password must be at least 8 characters.";
    }

    if (!formData.confirmPassword) {
      newErrors.confirmPassword =
        "Please confirm your password.";
    } else if (
      formData.password !== formData.confirmPassword
    ) {
      newErrors.confirmPassword =
        "Passwords do not match.";
    }

    setErrors(newErrors);

    return Object.keys(newErrors).length === 0;
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) return;

    const workspaceName = formData.tenantName.trim();
    const planCode = formData.planCode;

    registerMutation.mutate(
      {
        displayName: formData.displayName,
        email: formData.email,
        tenantName: workspaceName || "(joining an invited workspace)",
        planCode: formData.planCode,
        password: formData.password,
      },
      {
        onSuccess: (response) => {
          const pendingToken = response.pendingToken;

          onSuccess(
            pendingToken,
            formData.email,
            workspaceName,
            planCode
          );
        },
      }
    );
  };

  const errorMessage =
    registerMutation.error instanceof ApiError
      ? registerMutation.error.message
      : registerMutation.error
      ? "Something went wrong."
      : googleLoginMutation.error instanceof ApiError
      ? googleLoginMutation.error.message
      : googleLoginMutation.error
      ? "Something went wrong."
      : null;

  return (
    <>
      <div className="mb-2 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
          Create your account
        </h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Get started with your secure Zoiko Mail workspace.
        </p>
      </div>

      {errorMessage && (
        <div className="mb-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {errorMessage}
        </div>
      )}

      <GoogleSignInButton
        onSuccess={(idToken) => googleLoginMutation.mutate({ idToken })}
        label="Sign up with Google"
        disabled={registerMutation.isPending || googleLoginMutation.isPending}
      />

      <div className="relative my-2">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-200 dark:border-slate-700" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-white px-2 text-slate-500 dark:bg-slate-900 dark:text-slate-400">or</span>
        </div>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <FormInput
          label="Display Name"
          icon={FaUser}
          placeholder="John Doe"
          value={formData.displayName}
          onChange={(e) => handleChange("displayName", e.target.value)}
          error={errors.displayName}
        />

        <FormInput
          label="Email"
          type="email"
          icon={FaEnvelope}
          placeholder="john@example.com"
          value={formData.email}
          onChange={(e) => handleChange("email", e.target.value)}
          error={errors.email}
        />

        <FormInput
          label="Workspace Name (optional)"
          icon={FaBuilding}
          placeholder="Leave blank if you were invited to a team"
          value={formData.tenantName}
          onChange={(e) => handleChange("tenantName", e.target.value)}
          error={errors.tenantName}
        />

        <PasswordInput
          label="Password"
          placeholder="Create password"
          value={formData.password}
          onChange={(e) => handleChange("password", e.target.value)}
          error={errors.password}
        />

        <PasswordInput
          label="Confirm Password"
          placeholder="Confirm password"
          value={formData.confirmPassword}
          onChange={(e) => handleChange("confirmPassword", e.target.value)}
          error={errors.confirmPassword}
        />

        <button
          type="submit"
          disabled={registerMutation.isPending || googleLoginMutation.isPending}
          className="w-full rounded-lg bg-teal-600 px-4 py-2.5 font-medium text-white transition-all duration-200 hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {registerMutation.isPending ? "Creating Account..." : "Continue"}
        </button>
        <div className="">
          <p className="text-center text-sm text-slate-600 dark:text-slate-400">
            Already have an account?{" "}
            <button
              type="button"
              onClick={onBackToLogin}
              className="font-semibold text-teal-600 transition hover:text-teal-700 dark:text-teal-400"
            >
              Sign In
            </button>
          </p>
        </div>
      </form>
    </>
  );
}
