"use client";

import { useState } from "react";

import {
  AuthCard,
  AuthTabs,
  LoginForm,
  RegisterForm,
  ChangePasswordForm,
} from "@/components/auth";

type AuthTab = "login" | "register" | "password";

export default function LoginPage() {
  const [activeTab, setActiveTab] = useState<AuthTab>("login");

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 transition-colors dark:bg-slate-950">
      <AuthCard>
        <AuthTabs
          activeTab={activeTab}
          onChange={setActiveTab}
        />

        <div className="mt-6">
          {activeTab === "login" && <LoginForm />}

          {activeTab === "register" && <RegisterForm />}

          {activeTab === "password" && (
            <ChangePasswordForm />
          )}
        </div>
      </AuthCard>
    </main>
  );
}