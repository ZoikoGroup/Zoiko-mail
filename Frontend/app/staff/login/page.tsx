"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Eye, EyeOff, Loader2, AlertCircle } from "lucide-react";
import { useLogin } from "@/lib/auth-hooks";
import type { AuthResponse } from "@/lib/auth-api";

export default function StaffLoginPage() {
  const router = useRouter();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { document.title = "Staff Sign In | Zoiko Mail"; }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    login.mutate(
      { email, password },
      {
        onError: (err: Error & { response?: { data?: { error?: { message?: string } } } }) => {
          setError(err.response?.data?.error?.message ?? "Sign in failed. Please try again.");
        },
      }
    );
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--ground)] px-4 py-12">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Link href="/" aria-label="Zoiko Mail Home">
            <Image
              src="/zoiko-wordmark.png"
              alt="Zoiko Mail"
              width={185}
              height={24}
              priority
              className="h-6 w-auto dark:hidden"
            />
            <Image
              src="/zoiko-wordmark-dark.png"
              alt=""
              aria-hidden
              width={185}
              height={24}
              priority
              className="hidden h-6 w-auto dark:block"
            />
          </Link>
        </div>

        <div className="text-center mb-8">
          <h1 className="font-editorial text-2xl font-semibold text-[var(--ink)]">
            Staff Sign In
          </h1>
          <p className="mt-2 text-sm text-[var(--ink3)]">
            Access the Zoiko Support Console
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-[var(--crit-soft)] p-3 text-sm text-[var(--crit)]">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label
              htmlFor="email"
              className="mb-1.5 block text-sm font-medium text-[var(--ink2)]"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@zoiko.dev"
              required
              disabled={login.isPending}
              className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-sm font-medium text-[var(--ink2)]"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                disabled={login.isPending}
                className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 pr-10 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                disabled={login.isPending}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ink3)] hover:text-[var(--ink)] disabled:opacity-60"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={login.isPending || !email || !password}
            className="w-full zoiko-btn pri disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {login.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Signing in…
              </>
            ) : (
              "Sign In"
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-[var(--ink3)]">
          Not a staff member?{" "}
          <Link href="/login" className="text-[var(--accent)] hover:underline">
            Sign in to your workspace
          </Link>
        </p>

        <div className="mt-8 rounded-lg border border-[var(--border)] bg-[var(--s2)] p-4 text-xs text-[var(--ink3)]">
          <p className="font-medium mb-2">Staff Access</p>
          <ul className="space-y-1 list-disc list-inside">
            <li>Requires platform role: <code className="font-mono">SUPPORT</code> or <code className="font-mono">SUPER_ADMIN</code></li>
            <li>Grants access to the platform support console at <code className="font-mono">/support</code></li>
            <li>Session is platform-scoped (no tenant membership required)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}