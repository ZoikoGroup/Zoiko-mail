"use client";

import {
  HiCheckBadge,
  HiShieldCheck,
  HiBolt,
  HiSparkles,
} from "react-icons/hi2";

const FEATURES = [
  {
    icon: HiShieldCheck,
    title: "Enterprise Security",
    description:
      "Secure authentication with encrypted communication and modern identity management.",
  },
  {
    icon: HiBolt,
    title: "Lightning Fast",
    description:
      "Built for performance with a smooth and responsive experience across every device.",
  },
  {
    icon: HiSparkles,
    title: "Modern Workspace",
    description:
      "Collaborate, communicate and manage your organization from one secure platform.",
  },
];

export default function AuthShowcase() {
  return (
    <aside className="relative hidden overflow-hidden bg-gradient-to-br from-cyan-700 via-teal-700 to-slate-900 lg:flex">
      {/* Background Blur */}
      <div className="absolute -left-24 top-16 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
      <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-teal-500/10 blur-3xl" />

      {/* Grid Pattern */}
      <div
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage: `
            linear-gradient(to right, white 1px, transparent 1px),
            linear-gradient(to bottom, white 1px, transparent 1px)
          `,
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative z-10 flex h-screen w-full flex-col justify-between px-8 py-6">
        {/* ---------------- Logo ---------------- */}

        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white font-bold text-cyan-700 shadow-lg">
            Z
          </div>

          <div>
            <h2 className="text-xl font-bold text-white">
              Zoiko Mail
            </h2>

            <p className="text-sm text-cyan-100">
              Secure Business Communication
            </p>
          </div>
        </div>

        {/* ---------------- Hero Content ---------------- */}

        <div className="max-w-xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur">
            <HiCheckBadge className="text-base md:text-lg" />
            Trusted by Modern Teams
          </span>

          <h1 className="mt-2 text-xl md:text-2xl lg:text-3xl font-bold leading-tight text-white">
            Smarter &
            Secure Email
            Collaboration
          </h1>

          <p className="mt-2 max-w-lg text-base md:text-lg leading-8 text-cyan-100">
            Experience next-generation business communication with
            enterprise-grade security, intelligent collaboration,
            and effortless workspace management.
          </p>

          {/* Features */}

          <div className="mt-4 space-y-2">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;

              return (
                <div
                  key={feature.title}
                  className="flex gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur-sm transition-all duration-300 hover:bg-white/10"
                >
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-white text-cyan-700">
                    <Icon className="text-2xl" />
                  </div>

                  <div>
                    <h3 className="font-semibold text-white">
                      {feature.title}
                    </h3>

                    <p className="mt-1 text-sm leading-6 text-cyan-100">
                      {feature.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ---------------- Footer ---------------- */}

        <div className="flex items-center justify-between border-t border-white/10 pt-3">
          <div className="text-sm text-cyan-100">
            © 2026 Zoiko Group
          </div>

          <div className="flex items-center gap-3">
            <div className="h-2 w-2 rounded-full bg-green-400" />

            <span className="text-sm text-cyan-100">
              Secure Platform
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}