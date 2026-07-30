"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api-client";
import { useChangePassword } from "@/lib/auth-hooks";
import { PasswordInput } from ".";

type FormErrors = {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
};

export default function ChangePasswordForm() {
  const changePasswordMutation = useChangePassword();

  const [formData, setFormData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [successMessage, setSuccessMessage] = useState("");

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

    if (successMessage) {
      setSuccessMessage("");
    }
  };

  const validate = () => {
    const newErrors: FormErrors = {};

    if (!formData.currentPassword) {
      newErrors.currentPassword = "Current password is required.";
    }

    if (!formData.newPassword) {
      newErrors.newPassword = "New password is required.";
    } else if (formData.newPassword.length < 8) {
      newErrors.newPassword =
        "Password must be at least 8 characters.";
    }

    if (!formData.confirmPassword) {
      newErrors.confirmPassword =
        "Please confirm your new password.";
    } else if (
      formData.newPassword !== formData.confirmPassword
    ) {
      newErrors.confirmPassword =
        "Passwords do not match.";
    }

    if (
      formData.currentPassword &&
      formData.currentPassword === formData.newPassword
    ) {
      newErrors.newPassword =
        "New password must be different from the current password.";
    }

    setErrors(newErrors);

    return Object.keys(newErrors).length === 0;
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) return;

    changePasswordMutation.mutate(
      {
        currentPassword: formData.currentPassword,
        newPassword: formData.newPassword,
      },
      {
        onSuccess: () => {
          setSuccessMessage("Password updated successfully.");

          setFormData({
            currentPassword: "",
            newPassword: "",
            confirmPassword: "",
          });
        },
      }
    );
  };

  const errorMessage =
    changePasswordMutation.error instanceof ApiError
      ? changePasswordMutation.error.message
      : changePasswordMutation.error
      ? "Something went wrong."
      : null;

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <PasswordInput
        label="Current Password"
        placeholder="Enter current password"
        value={formData.currentPassword}
        onChange={(e) =>
          handleChange("currentPassword", e.target.value)
        }
        error={errors.currentPassword}
      />

      <PasswordInput
        label="New Password"
        placeholder="Enter new password"
        value={formData.newPassword}
        onChange={(e) =>
          handleChange("newPassword", e.target.value)
        }
        error={errors.newPassword}
      />

      <PasswordInput
        label="Confirm Password"
        placeholder="Confirm new password"
        value={formData.confirmPassword}
        onChange={(e) =>
          handleChange("confirmPassword", e.target.value)
        }
        error={errors.confirmPassword}
      />

      {successMessage && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
          {successMessage}
        </div>
      )}

      {errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {errorMessage}
        </div>
      )}

      <button
        type="submit"
        disabled={changePasswordMutation.isPending}
        className="w-full rounded-lg bg-teal-600 px-4 py-2.5 font-medium text-white transition-all duration-200 hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {changePasswordMutation.isPending
          ? "Updating Password..."
          : "Update Password"}
      </button>
    </form>
  );
}