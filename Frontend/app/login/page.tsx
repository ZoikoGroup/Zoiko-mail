"use client";

import { useState } from "react";

import {
  AuthLayout,
  AuthContainer,
  LoginForm,
  RegisterForm,
  VerifyOtpForm,
  CreateWorkspaceForm,
  ForgotPasswordForm,
  ResetPasswordForm,
} from "@/components/auth";
// import VerifyOtpForm from "@/components/auth/forms/VerifyOtpForm";

import type { AuthStep } from "@/components/auth";

export default function AuthPage() {
  const [step, setStep] = useState<AuthStep>("login");
  const [pendingToken, setPendingToken] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");
  const [resetEmail, setResetEmail] = useState("");

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
            onSuccess={(token) => {
              setPendingToken(token);
              setVerificationEmail(verificationEmail);
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
            onSuccess={(newToken) => {
              setPendingToken(newToken);
              setStep("workspace");
            }}
          />
        );

      case "workspace":
        return (
          <CreateWorkspaceForm
            token={pendingToken}
            email={verificationEmail}
            onSuccess={() => {
              // Temporary
              // setStep("login");

              // Later we'll redirect after backend confirmation
            }}
          />
        );

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