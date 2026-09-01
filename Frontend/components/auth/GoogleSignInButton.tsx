"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * "Continue with Google", matched to the form's own styling.
 *
 * Two things are in tension here. Google's `renderButton` is the only reliable
 * trigger — `initialize` + `prompt` is the One Tap API, which Google suppresses
 * with an escalating cooldown once dismissed, so a button wired to it works a
 * few times and then silently does nothing, sending no request at all. But
 * renderButton draws Google's own control: a fixed 40px height in Google's
 * font, which sits visibly short beside the 48px rounded-xl inputs here.
 *
 * So Google's button is still the thing being clicked — stretched to fill the
 * area and made transparent — while the visible surface underneath is ours.
 * The click genuinely lands on Google's control, so nothing about the auth
 * behaviour is faked; only the paint is.
 */

const GSI_SRC = "https://accounts.google.com/gsi/client";

interface GoogleIdConfig {
  client_id: string;
  callback: (response: { credential?: string }) => void;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
}

interface GoogleButtonOptions {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "small" | "medium" | "large";
  text?: "signin_with" | "signup_with" | "continue_with";
  shape?: "rectangular" | "pill";
  logo_alignment?: "left" | "center";
  width?: number;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: GoogleIdConfig) => void;
          renderButton: (parent: HTMLElement, options: GoogleButtonOptions) => void;
        };
      };
    };
  }
}

function loadGsi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.accounts?.id) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("script failed")));
      return;
    }
    const script = document.createElement("script");
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("script failed"));
    // Never removed on unmount: pulling the tag mid-load, which React
    // StrictMode's double-effect makes likely in development, leaves
    // window.google half-initialised and the button dead.
    document.head.appendChild(script);
  });
}

/** Google's four-colour mark, at the same 20px as the form's other icons. */
function GoogleMark() {
  return (
    <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden focusable="false">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11.96 11.96 0 0 0 1 12c0 1.94.46 3.77 1.18 5.07l3.66-2.84v-.14Z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53Z" fill="#EA4335" />
    </svg>
  );
}

interface GoogleSignInButtonProps {
  onSuccess: (idToken: string) => void;
  disabled?: boolean;
  /** "continue_with" on sign-in, "signup_with" on the register screen. */
  label?: string;
}

export default function GoogleSignInButton({
  onSuccess,
  disabled,
  label = "Continue with Google",
}: GoogleSignInButtonProps) {
  const holder = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  // Held in a ref so a parent re-render cannot re-run the effect and stack a
  // second Google button behind the first.
  const handler = useRef(onSuccess);
  handler.current = onSuccess;

  const mount = useCallback(() => {
    const id = window.google?.accounts?.id;
    if (!id || !holder.current || !clientId) return;

    id.initialize({
      client_id: clientId,
      callback: (response) => {
        // No credential is the ordinary case of closing the chooser.
        if (response.credential) handler.current(response.credential);
      },
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    holder.current.innerHTML = "";
    id.renderButton(holder.current, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "rectangular",
      logo_alignment: "left",
      width: 400,
    });
  }, [clientId]);

  useEffect(() => {
    if (!clientId) {
      // Google fails silently on an empty client id, so say so rather than
      // showing a control that cannot work.
      setError("Google sign-in is not configured.");
      return;
    }
    loadGsi().then(mount).catch(() => setError("Google sign-in could not load."));
  }, [clientId, mount]);

  if (error) {
    return (
      <p role="alert" className="text-center text-xs text-slate-500 dark:text-slate-400">
        {error}
      </p>
    );
  }

  return (
    <div className={`relative h-10 w-full ${disabled ? "pointer-events-none opacity-60" : ""}`} style={{ clipPath: "inset(0)" }}>
      {/* What the user sees: the same height, radius, border and type scale as
          the form's own buttons. Non-interactive, so every click falls through
          to Google's control above it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 transition-colors dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
      >
        <GoogleMark />
        {label}
      </div>

      {/* Google's real button: stretched to the full area so the whole surface
          is clickable, and transparent so ours is what shows. */}
      <div
        ref={holder}
        className="absolute inset-0 z-10 overflow-hidden opacity-0 [&>div]:!h-full [&>div]:!w-full [&_iframe]:!h-full [&_iframe]:!w-full"
      />
    </div>
  );
}
