"use client";

import { useState } from "react";
import { FaBuilding, FaEnvelope, FaUser } from "react-icons/fa";

import { ApiError } from "@/lib/api-client";
import { useRegister } from "@/lib/auth-hooks";

import { FormInput, PasswordInput } from "..";

type FormErrors = {
  displayName?: string;
  email?: string;
  tenantName?: string;
  password?: string;
  confirmPassword?: string;
};

interface RegisterFormProps {
  onBackToLogin: () => void;
  // onSuccess: (pendingToken: string) => void;
  onSuccess: (pendingToken: string, tenantName: string, planCode: string) => void;
}

export default function RegisterForm({
  onBackToLogin,
  onSuccess,
}: RegisterFormProps) {
  const registerMutation = useRegister();

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
      !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(formData.email)
    ) {
      newErrors.email = "Enter a valid email address.";
    }

    // if (!formData.tenantName.trim()) {
    //   newErrors.tenantName = "Tenant name is required.";
    // }

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

    const workspaceName = `${formData.displayName.trim()}'s Workspace`;
    const planCode = "starter";

    registerMutation.mutate(
      {
        displayName: formData.displayName,
        email: formData.email,
        tenantName: formData.tenantName,
        planCode: formData.planCode,
        password: formData.password,
      },
      {
        onSuccess: (response) => {
          console.log("REGISTER RESPONSE", response);

          // const pendingToken = response.data.pendingToken;
          const pendingToken = response.pendingToken;

          // onSuccess(pendingToken);
          onSuccess(pendingToken, workspaceName, planCode);
        },
      }
    );
  };

  const errorMessage =
    registerMutation.error instanceof ApiError
      ? registerMutation.error.message
      : registerMutation.error
        ? "Something went wrong."
        : null;

  return (
    <>
      <div className="mb-4 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
          Create your account
        </h2>

        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          Get started with your secure Zoiko Mail workspace.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <FormInput
          label="Display Name"
          icon={FaUser}
          placeholder="John Doe"
          value={formData.displayName}
          onChange={(e) =>
            handleChange("displayName", e.target.value)
          }
          error={errors.displayName}
        />

        <FormInput
          label="Email"
          type="email"
          icon={FaEnvelope}
          placeholder="john@example.com"
          value={formData.email}
          onChange={(e) =>
            handleChange("email", e.target.value)
          }
          error={errors.email}
        />

        {/* <FormInput
          label="Tenant Name"
          icon={FaBuilding}
          placeholder="Acme Pvt Ltd"
          value={formData.tenantName}
          onChange={(e) =>
            handleChange("tenantName", e.target.value)
          }
          error={errors.tenantName}
        /> */}

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Plan
          </label>

          <select
            value={formData.planCode}
            onChange={(e) =>
              handleChange("planCode", e.target.value)
            }
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          >
            <option value="starter">Starter</option>
          </select>
        </div>

        <PasswordInput
          label="Password"
          placeholder="Create password"
          value={formData.password}
          onChange={(e) =>
            handleChange("password", e.target.value)
          }
          error={errors.password}
        />

        <PasswordInput
          label="Confirm Password"
          placeholder="Confirm password"
          value={formData.confirmPassword}
          onChange={(e) =>
            handleChange("confirmPassword", e.target.value)
          }
          error={errors.confirmPassword}
        />

        {errorMessage && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {errorMessage}
          </div>
        )}

        <button
          type="submit"
          disabled={registerMutation.isPending}
          className="w-full rounded-lg bg-teal-600 px-4 py-2.5 font-medium text-white transition-all duration-200 hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {registerMutation.isPending
            ? "Creating Account..."
            : "Continue"}
        </button>
        <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
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