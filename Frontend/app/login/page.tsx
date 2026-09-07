"use client";

import { useEffect, useState } from "react";

import {
  AuthLayout,
  AuthContainer,
  LoginForm,
  RegisterForm,
  VerifyOtpForm,
  CreateWorkspaceForm,
  JoinWorkspaceForm,
  ForgotPasswordForm,
  ResetPasswordForm,
} from "@/components/auth";

import type { AuthStep } from "@/components/auth";
import type { PendingInvitation } from "@/lib/auth-api";
import { useCreateWorkspace } from "@/lib/auth-hooks";

export default function AuthPage() {
  useEffect(() => { document.title = "Sign In | Zoiko Mail"; }, []);
  const [step, setStep] = useState<AuthStep>("login");
  const [pendingToken, setPendingToken] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const createWorkspace = useCreateWorkspace();
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspacePlan, setWorkspacePlan] = useState("starter");
  // Invitations found for the registering email — non-empty means the
  // account should join an existing workspace (ADMIN/MEMBER) instead of
  // creating a new one as OWNER.
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);

  const renderStep = () => {
    switch (step) {
      case "login":
        return (
          <LoginForm
            onRegister={() => setStep("register")}
            onForgotPassword={() => setStep("forgotPassword")}
          />
        );

      case "register":
        return (
          <RegisterForm
            onBackToLogin={() => setStep("login")}
            // onSuccess={(token) => {
            //   setPendingToken(token);
            //   setVerificationEmail(verificationEmail);
            //   setStep("verifyOtp");
            // }}
            onSuccess={(token, email, tenantName, planCode) => {
              setPendingToken(token);
              setVerificationEmail(email);
              setWorkspaceName(tenantName);
              setWorkspacePlan(planCode);
              setStep("verifyOtp");
            }}
          />
        );

      case "verifyOtp":
        return (
          <VerifyOtpForm
            token={pendingToken}
            email={verificationEmail}
            onBack={() => setStep("register")}
            onSuccess={(newToken, pendingInvitations) => {
              if (pendingInvitations.length > 0) {
                // Invited account → join as ADMIN/MEMBER.
                setPendingToken(newToken);
                setInvitations(pendingInvitations);
                setStep("joinWorkspace");
                return;
              }
              // No invitations → own workspace as OWNER.
              createWorkspace.mutate(
                {
                  token: newToken,
                  tenantName: workspaceName,
                  planCode: workspacePlan,
                },
                { onError: () => alert("Couldn't finish setting up your account. Please try again.") }
              );
            }}
          />
        );

      case "joinWorkspace":
        return (
          <JoinWorkspaceForm
            token={pendingToken}
            invitations={invitations}
            onBack={() => setStep("login")}
          />
        );

      // case "workspace":
      //   return (
      //     <CreateWorkspaceForm
      //       token={pendingToken}
      //       email={verificationEmail}
      //       onSuccess={() => {
      //       }}
      //     />
      //   );

      case "forgotPassword":
        return (
          <ForgotPasswordForm
            onBackToLogin={() => setStep("login")}
            onSuccess={(email) => {
              setResetEmail(email);
              setStep("resetPassword");
            }}
          />
        );

      case "resetPassword":
        return (
          <ResetPasswordForm
            email={resetEmail}
            onBackToLogin={() => setStep("login")}
            onSuccess={() => setStep("login")}
          />
        );

      default:
        return null;
    }
  };

  return (
    <AuthLayout>
      <AuthContainer>
        {renderStep()}
      </AuthContainer>
    </AuthLayout>
  );
}