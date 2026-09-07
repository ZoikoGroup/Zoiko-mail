"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AuthLayout, AuthContainer, CreateWorkspaceForm } from "@/components/auth";

/**
 * First workspace for an account that has none.
 *
 * Every brand-new Google signup lands here: the account exists and Google has
 * verified the address, but it belongs to no workspace, so there is nothing to
 * sign in to until one is created. The backend returns NO_WORKSPACE with a
 * pending token for exactly this, and /auth/create-workspace is the only
 * endpoint that accepts it.
 *
 * Its own route rather than a step on /login, for two reasons. The sign-in
 * happens on /login, so routing back to /login is a same-URL navigation that
 * re-renders without remounting — a mount effect there would never fire and
 * the user would sit on the form they just came from. And this page must stay
 * outside ProtectedRoute, which requires a session that does not exist yet.
 *
 * Mirrors /select-workspace: read the stash the auth hook left, and bounce to
 * /login if someone arrives here directly without one.
 */
export default function CreateFirstWorkspacePage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [ready, setReady] = useState(false);

  // Reads the stash without consuming it, so running twice is harmless.
  //
  // This effect used to delete the token as soon as it had read it, which
  // broke the screen in exactly the way it was added to fix: React
  // StrictMode double-invokes effects in development, so the second run
  // found nothing and redirected to /login. The page appeared for about
  // 400ms and then threw the user back at the login form — see the same
  // trap, and the same cause, noted in app/accept-invitation/page.tsx.
  //
  // Keeping the token also means a refresh on this page still works, which
  // a one-shot read could never do however the double-invoke was guarded.
  // It is cleared once the workspace actually exists.
  useEffect(() => {
    document.title = "Create your workspace | Zoiko Mail";

    const stashed = sessionStorage.getItem("zoiko.workspace_token");
    if (!stashed) {
      router.replace("/login");
      return;
    }

    setToken(stashed);
    setEmail(sessionStorage.getItem("zoiko.workspace_email") ?? "");
    setReady(true);
  }, [router]);

  const clearStash = () => {
    sessionStorage.removeItem("zoiko.workspace_token");
    sessionStorage.removeItem("zoiko.workspace_email");
  };

  if (!ready || !token) {
    return (
      <AuthLayout>
        <AuthContainer>
          <div className="flex h-40 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
          </div>
        </AuthContainer>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthContainer>
        {/* The form runs the mutation itself and useCreateWorkspace stores the
            session and moves the user on, so the only thing left is to drop
            the stash now that the token has been spent. */}
        <CreateWorkspaceForm token={token} email={email} onSuccess={clearStash} />
      </AuthContainer>
    </AuthLayout>
  );
}
