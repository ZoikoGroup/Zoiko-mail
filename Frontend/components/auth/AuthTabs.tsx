"use client";

type Tab = "login" | "register" | "password";

interface Props {
  activeTab: Tab;
  onChange: (tab: Tab) => void;
}

const tabs: {
  label: string;
  value: Tab;
}[] = [
  {
    label: "Login",
    value: "login",
  },
  {
    label: "Register",
    value: "register",
  },
  {
    label: "Password",
    value: "password",
  },
];

export default function AuthTabs({
  activeTab,
  onChange,
}: Props) {
  return (
    <div className="mb-8 flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-300
            ${
              activeTab === tab.value
                ? "bg-white text-teal-600 shadow dark:bg-slate-900 dark:text-teal-400"
                : "text-slate-600 hover:text-teal-600 dark:text-slate-400"
            }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}