"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { GoogleOAuthProvider } from "@react-oauth/google";

import { AuthContainer, AuthLayout, MemberLoginForm } from "@/components/auth";
import { ApiError } from "@/lib/api-client";
import { fetchMemberLoginLink } from "@/lib/auth-api";
import { GOOGLE_CLIENT_ID } from "@/lib/config";

/**
 * A mailbox's Member sign-in link, as copied from the admin Mailboxes page.
 *
 * Resolves the key to the workspace and the owner's email and prefills the
 * Member login with them. The link signs nobody in; a key that no longer
 * matches (regenerated, mistyped) still leaves a working form, with a note.
 */
export default function MemberLoginLinkPage() {
  const params = useParams<{ key: string }>();
  const key = typeof params?.key === "string" ? params.key : "";

  useEffect(() => {
    document.title = "Member Sign In | Zoiko Mail";
  }, []);

  const link = useQuery({
    queryKey: ["member-login-link", key],
    queryFn: () => fetchMemberLoginLink(key),
    enabled: key.length > 0,
    retry: false,
    staleTime: Infinity,
  });

  const linkError = link.error
    ? link.error instanceof ApiError && link.error.status === 404
      ? "This sign-in link is no longer valid. You can still sign in below, or ask your administrator for the current link."
      : "This sign-in link could not be checked right now. You can still sign in below."
    : null;

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <AuthLayout>
        <AuthContainer>
          {link.isLoading ? (
            <p className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">Checking your sign-in link…</p>
          ) : (
            <MemberLoginForm link={link.data ?? null} linkError={linkError} />
          )}
        </AuthContainer>
      </AuthLayout>
    </GoogleOAuthProvider>
  );
}
