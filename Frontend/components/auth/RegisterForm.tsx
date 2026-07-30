"use client";

import { useState } from "react";
import { FaBuilding, FaEnvelope, FaUser } from "react-icons/fa";

import { ApiError } from "@/lib/api-client";
import { useRegister } from "@/lib/auth-hooks";

import { FormInput, PasswordInput } from ".";

type FormErrors = {
  displayName?: string;
  email?: string;
  tenantName?: string;
  password?: string;
  confirmPassword?: string;
};

export default function RegisterForm() {
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

    if (!formData.tenantName.trim()) {
      newErrors.tenantName = "Tenant name is required.";
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

    registerMutation.mutate({
      displayName: formData.displayName,
      email: formData.email,
      tenantName: formData.tenantName,
      planCode: formData.planCode,
      password: formData.password,
    });
  };

  const errorMessage =
    registerMutation.error instanceof ApiError
      ? registerMutation.error.message
      : registerMutation.error
      ? "Something went wrong."
      : null;

  return (
    <form onSubmit={onSubmit} className="space-y-5">
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

      <FormInput
        label="Tenant Name"
        icon={FaBuilding}
        placeholder="Acme Pvt Ltd"
        value={formData.tenantName}
        onChange={(e) =>
          handleChange("tenantName", e.target.value)
        }
        error={errors.tenantName}
      />

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
          : "Create Account"}
      </button>
    </form>
  );
}