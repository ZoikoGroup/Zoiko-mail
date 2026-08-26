"use client";

import { useCallback, useEffect, useState } from "react";
import { FaGoogle } from "react-icons/fa";

import { ApiError } from "@/lib/api-client";
import { useAuthProviders, useGoogleLogin } from "@/lib/auth-hooks";

/**
 * "Continue with Google", wired to the authorization-code popup flow.
 *
 * The popup returns a single-use **code**, which is posted to the API and
 * exchanged there using the client secret. The browser never handles a token
 * and never asserts an identity — that is what keeps this from being a
 * vulnerability rather than a feature.
 *
 * Renders nothing when the server reports Google sign-in unconfigured. The
 * button previously existed with no handler at all, so it looked functional and
 * silently did nothing; an absent button is more honest than a dead one.
 */

const GSI_SRC = "https://accounts.google.com/gsi/client";

interface CodeClient {
  requestCode: () => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initCodeClient: (config: {
            client_id: string;
            scope: string;
            ux_mode: "popup";
            callback: (response: { code?: string; error?: string }) => void;
          }) => CodeClient;
        };
      };
    };
  }
}

function loadGsi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.accounts?.oauth2) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Google script failed")));
      return;
    }
    const script = document.createElement("script");
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google script failed"));
    document.head.appendChild(script);
  });
}

export default function GoogleSignInButton() {
  const { data: providers } = useAuthProviders();
  const googleLogin = useGoogleLogin();
  const [scriptError, setScriptError] = useState(false);
  const [busy, setBusy] = useState(false);

  const enabled = providers?.google.enabled === true && Boolean(providers.google.clientId);

  // Only fetch Google's script when the server says the feature exists, so an
  // unconfigured deployment makes no third-party request at all.
  useEffect(() => {
    if (!enabled) return;
    loadGsi().catch(() => setScriptError(true));
  }, [enabled]);

  const start = useCallback(() => {
    const clientId = providers?.google.clientId;
    const oauth2 = window.google?.accounts?.oauth2;
    if (!clientId || !oauth2) {
      setScriptError(true);
      return;
    }
    setBusy(true);
    oauth2
      .initCodeClient({
        client_id: clientId,
        // Identity only. Mail access is a separate, per-mailbox consent.
        scope: "openid email profile",
        ux_mode: "popup",
        callback: (response) => {
          if (!response.code) {
            // Includes the ordinary case of the user closing the popup.
            setBusy(false);
            return;
          }
          googleLogin.mutate(response.code, { onSettled: () => setBusy(false) });
        },
      })
      .requestCode();
  }, [providers, googleLogin]);

  if (!enabled) return null;

  const message = scriptError
    ? "Google sign-in could not load. Use your email and password."
    : googleLogin.error
      ? googleLogin.error instanceof ApiError
        ? googleLogin.error.message
        : "Google sign-in failed. Try again."
      : null;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={start}
        disabled={busy || googleLogin.isPending || scriptError}
        className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white text-sm font-medium text-slate-700 transition-all duration-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <FaGoogle className="text-lg text-red-500" />
        {busy || googleLogin.isPending ? "Signing in…" : "Continue with Google"}
      </button>

      {message && (
        <p role="alert" className="text-center text-xs text-red-600 dark:text-red-400">
          {message}
        </p>
      )}
    </div>
  );
}
