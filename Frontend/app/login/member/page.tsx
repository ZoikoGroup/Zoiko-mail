"use client";

import { useEffect } from "react";

import { AuthContainer, AuthLayout, MemberLoginForm } from "@/components/auth";

/**
 * The Member-only sign-in, reached from "Login as Member/User" on /login.
 * Email and password only, so Google's sign-in client is not loaded here.
 */
export default function MemberLoginPage() {
  useEffect(() => {
    document.title = "Member Sign In | Zoiko Mail";
  }, []);

  return (
    <AuthLayout>
      <AuthContainer>
        <MemberLoginForm />
      </AuthContainer>
    </AuthLayout>
  );
}
