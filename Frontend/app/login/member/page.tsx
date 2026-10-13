"use client";

import { useEffect } from "react";
import { GoogleOAuthProvider } from "@react-oauth/google";

import { AuthContainer, AuthLayout, MemberLoginForm } from "@/components/auth";
import { GOOGLE_CLIENT_ID } from "@/lib/config";

/** The Member-only sign-in, reached from "Login as Member/User" on /login. */
export default function MemberLoginPage() {
  useEffect(() => {
    document.title = "Member Sign In | Zoiko Mail";
  }, []);

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <AuthLayout>
        <AuthContainer>
          <MemberLoginForm />
        </AuthContainer>
      </AuthLayout>
    </GoogleOAuthProvider>
  );
}
