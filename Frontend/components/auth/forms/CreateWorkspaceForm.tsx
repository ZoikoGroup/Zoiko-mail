"use client";

import { useEffect, useState } from "react";
import { FaBuilding } from "react-icons/fa";

import { ApiError } from "@/lib/api-client";
import { useCreateWorkspace } from "@/lib/auth-hooks";

import { FormInput } from "..";

interface CreateWorkspaceFormProps {
  token: string;
  email?: string;
  onSuccess: () => void;
}

type FormErrors = {
  tenantName?: string;
};

export default function CreateWorkspaceForm({
  token,
  email,
  onSuccess,
}: CreateWorkspaceFormProps) {
  const workspaceMutation = useCreateWorkspace();

  const [formData, setFormData] = useState({
    tenantName: "",
    planCode: "starter",
  });

  const [errors, setErrors] =
    useState<FormErrors>({});

  useEffect(() => {
    if (!email) return;

    const workspaceName =
      email.split("@")[0].replace(/\./g, " ");

    setFormData((prev) => ({
      ...prev,
      tenantName:
        workspaceName.charAt(0).toUpperCase() +
        workspaceName.slice(1) +
        "'s Workspace",
    }));
  }, [email]);

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

    if (!formData.tenantName.trim()) {
      newErrors.tenantName =
        "Workspace name is required.";
    } else if (
      formData.tenantName.trim().length < 3
    ) {
      newErrors.tenantName =
        "Workspace name must be at least 3 characters.";
    }

    setErrors(newErrors);

    return Object.keys(newErrors).length === 0;
  };

  const onSubmit = (
    e: React.FormEvent<HTMLFormElement>
  ) => {
    e.preventDefault();

    if (!validate()) return;

    workspaceMutation.mutate(
      {
        token,
        tenantName: formData.tenantName,
        planCode: formData.planCode,
      },
      {
        onSuccess: () => {
          onSuccess();
        },
      }
    );
  };

  const errorMessage =
    workspaceMutation.error instanceof ApiError
      ? workspaceMutation.error.message
      : workspaceMutation.error
      ? "Something went wrong."
      : null;

  return (
    <>
      {/* =============================================
          HEADER
      ============================================== */}

      <div className="mb-10 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/40">
          <FaBuilding className="text-2xl text-teal-600 dark:text-teal-400" />
        </div>

        <h2 className="text-3xl font-bold text-slate-900 dark:text-white">
          Create your Workspace
        </h2>

        <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
          Your workspace is where you&apos;ll manage
          your organization, users and settings.
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="space-y-6"
      >
                {/* =============================================
            Workspace Name
        ============================================== */}

        <FormInput
          label="Workspace Name"
          icon={FaBuilding}
          placeholder="Enter your workspace name"
          value={formData.tenantName}
          onChange={(e) =>
            handleChange(
              "tenantName",
              e.target.value
            )
          }
          error={errors.tenantName}
        />

        {/* =============================================
            Workspace Plan
        ============================================== */}

        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            Workspace Plan
          </label>

          <select
            value={formData.planCode}
            onChange={(e) =>
              handleChange(
                "planCode",
                e.target.value
              )
            }
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition-all duration-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:border-teal-400 dark:focus:ring-teal-400"
          >
            <option value="starter">
              Starter
            </option>

            <option value="business_starter">
              Business Starter
            </option>

            <option value="business_pro">
              Business Pro
            </option>

            <option value="enterprise">
              Enterprise
            </option>
          </select>

          <p className="text-xs text-slate-500 dark:text-slate-400">
            You can change your workspace plan
            later from your account settings.
          </p>
        </div>

        {/* =============================================
            Error Message
        ============================================== */}

        {errorMessage && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {errorMessage}
          </div>
        )}

        {/* =============================================
            Continue Button
        ============================================== */}

        <button
          type="submit"
          disabled={workspaceMutation.isPending}
          className="flex h-12 w-full items-center justify-center rounded-xl bg-teal-600 text-sm font-semibold text-white transition-all duration-300 hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {workspaceMutation.isPending
            ? "Creating Workspace..."
            : "Continue"}
        </button>
                {/* =============================================
            Success Information
        ============================================== */}

        <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 dark:border-teal-900/40 dark:bg-teal-950/20">
          <h3 className="mb-2 text-sm font-semibold text-teal-700 dark:text-teal-300">
            Almost there!
          </h3>

          <p className="text-sm leading-6 text-teal-700 dark:text-teal-200">
            Your email has already been verified successfully.
            Creating a workspace will complete your account
            setup and activate your organization.
          </p>
        </div>

        {/* =============================================
            Workspace Information
        ============================================== */}

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
          <h3 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            What is a Workspace?
          </h3>

          <ul className="space-y-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            <li>• Manage your organization from one place.</li>
            <li>• Invite team members securely.</li>
            <li>• Configure settings and permissions.</li>
            <li>• Upgrade your subscription whenever needed.</li>
          </ul>
        </div>

        {/* =============================================
            Security Notice
        ============================================== */}

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
          <p className="text-center text-xs leading-6 text-amber-700 dark:text-amber-200">
            Your workspace name can be changed later if needed.
            Your selected plan can also be upgraded or modified
            from the billing section after setup.
          </p>
        </div>

        {/* =============================================
            Footer
        ============================================== */}

        <div className="border-t border-slate-200 pt-6 dark:border-slate-700">
          <p className="text-center text-xs leading-6 text-slate-500 dark:text-slate-500">
            By continuing you agree to our{" "}
            <a
              href="/terms"
              className="font-medium text-teal-600 hover:underline dark:text-teal-400"
            >
              Terms of Service
            </a>{" "}
            and{" "}
            <a
              href="/privacy"
              className="font-medium text-teal-600 hover:underline dark:text-teal-400"
            >
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </form>
    </>
  );
}
