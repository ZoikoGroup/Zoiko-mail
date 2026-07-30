"use client";

import { useState } from "react";
import { FaEnvelope } from "react-icons/fa";

import { ApiError } from "@/lib/api-client";
import { useLogin } from "@/lib/auth-hooks";

import { FormInput, PasswordInput } from ".";

export default function LoginForm() {
  const loginMutation = useLogin();

  const [formData, setFormData] = useState({
    email: "",
    password: "",
    tenantId: "",
  });

  const [errors, setErrors] = useState<{
    email?: string;
    password?: string;
  }>({});

  const handleChange = (field: keyof typeof formData, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));

    if (field === "email" || field === "password") {
      setErrors((prev) => ({
        ...prev,
        [field]: undefined,
      }));
    }
  };

  const validate = () => {
    const newErrors: typeof errors = {};

    if (!formData.email.trim()) {
      newErrors.email = "Email is required.";
    } else if (
      !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(formData.email)
    ) {
      newErrors.email = "Enter a valid email address.";
    }

    if (!formData.password) {
      newErrors.password = "Password is required.";
    }

    setErrors(newErrors);

    return Object.keys(newErrors).length === 0;
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) return;

    loginMutation.mutate({
      email: formData.email,
      password: formData.password,
      tenantId: formData.tenantId || undefined,
    //   onSuccess: () => {
    //     setFormData({
    //       email: "",
    //       password: "",
    //       tenantId: "",
    //     });
    //   }
    });
  };

  const errorMessage =
    loginMutation.error instanceof ApiError
      ? loginMutation.error.message
      : loginMutation.error
      ? "Something went wrong."
      : null;

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <FormInput
        label="Email"
        type="email"
        placeholder="you@example.com"
        icon={FaEnvelope}
        value={formData.email}
        onChange={(e) => handleChange("email", e.target.value)}
        error={errors.email}
      />

      <PasswordInput
        label="Password"
        placeholder="••••••••"
        value={formData.password}
        onChange={(e) => handleChange("password", e.target.value)}
        error={errors.password}
      />

      {/* Future Multi-Tenant Support */}

      {/*
      <FormInput
        label="Tenant ID (Optional)"
        placeholder="tenant-id"
        value={formData.tenantId}
        onChange={(e) =>
          handleChange("tenantId", e.target.value)
        }
      />
      */}

      {errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {errorMessage}
        </div>
      )}

      <button
        type="submit"
        disabled={loginMutation.isPending}
        className="w-full rounded-lg bg-teal-600 px-4 py-2.5 font-medium text-white transition-all duration-200 hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loginMutation.isPending ? "Signing In..." : "Sign In"}
      </button>
    </form>
  );
}