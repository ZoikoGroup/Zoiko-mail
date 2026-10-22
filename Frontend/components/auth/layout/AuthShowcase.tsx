"use client";

import {
  HiCheckCircle,
  HiShieldCheck,
  HiBolt,
  HiUserGroup,
} from "react-icons/hi2";
import Image from "next/image";

const NAV_ITEMS = ["Secure", "Collaborate", "Organise", "Get More Done"];

const FEATURES = [
  {
    icon: HiShieldCheck,
    title: "Enterprise-Grade Security",
    description:
      "Encrypted communication, advanced threat protection and modern identity management.",
  },
  {
    icon: HiBolt,
    title: "Lightning Fast",
    description:
      "Optimised for speed and reliability across every device.",
  },
  {
    icon: HiUserGroup,
    title: "Modern Workspace",
    description:
      "Collaborate, communicate and manage your organisation from one secure platform.",
  },
];

const TRUST_BADGES = ["Secure Platform", "Global Access", "Business Ready"];

export default function AuthShowcase() {
  return (
    <aside className="relative hidden overflow-hidden bg-[#06163a] lg:flex">
      {/* Office photo, anchored right so the laptop stays in view as the
          panel narrows. */}
      <Image
        src="/login-bg.jpeg"
        alt=""
        fill
        priority
        sizes="55vw"
        className="object-cover object-right"
      />
      {/* Navy wash from the left keeps the copy readable over the photo;
          the bottom fade does the same for the footer. */}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(6,22,58,0.97)_0%,rgba(7,26,68,0.92)_45%,rgba(10,34,87,0.5)_75%,rgba(10,34,87,0.15)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#06163a]/90 to-transparent" />

      <div className="relative z-10 flex h-screen w-full flex-col justify-between gap-4 px-8 py-8 xl:px-14 [@media(max-height:760px)]:py-5">
        {/* ---------------- Logo + nav ---------------- */}

        <div className="flex items-start justify-between gap-4">
          <div>
            {/*
              The light lockup, because this panel is dark in both themes. The
              default asset is navy ink, which would vanish here.
            */}
            <Image
              src="/zoiko-wordmark-dark.png"
              width={277}
              height={36}
              className="h-8 w-auto xl:h-9"
              alt="Zoiko Mail"
              priority
            />
            <p className="mt-3 whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.2em] text-white/80 xl:text-xs xl:tracking-[0.25em]">
              Securely access your workspace
            </p>
          </div>

          <nav
            aria-label="Zoiko Mail highlights"
            className="flex shrink-0 items-center pt-2 text-[10px] font-semibold uppercase tracking-wide text-white/85 xl:text-[11px] 2xl:text-xs 2xl:tracking-wider"
          >
            {NAV_ITEMS.map((item, index) => (
              <span key={item} className="flex items-center whitespace-nowrap">
                {index > 0 && <span className="mx-2 h-3 w-px bg-white/40 xl:mx-3" aria-hidden />}
                {item}
              </span>
            ))}
          </nav>
        </div>

        {/* ---------------- Hero Content ---------------- */}

        <div className="max-w-xl">
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-white xl:text-5xl [@media(max-height:760px)]:text-4xl">
            Smarter, Safer
            <span className="block text-blue-400">Email Collaboration</span>
          </h1>

          <p className="mt-4 max-w-lg text-base leading-7 text-blue-100/85 xl:text-lg [@media(max-height:760px)]:mt-3 [@media(max-height:760px)]:text-base">
            A modern email and workspace platform for teams and organisations.
            Built for security, productivity and seamless collaboration.
          </p>

          {/* Features */}

          <div className="mt-8 space-y-5 [@media(max-height:760px)]:mt-5 [@media(max-height:760px)]:space-y-3">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;

              return (
                <div key={feature.title} className="flex items-center gap-4">
                  <div className="flex h-14 w-14 [@media(max-height:760px)]:h-12 [@media(max-height:760px)]:w-12 flex-shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-white shadow-lg shadow-black/20 backdrop-blur-sm">
                    <Icon className="text-2xl" />
                  </div>

                  <div>
                    <h3 className="font-semibold text-white">
                      {feature.title}
                    </h3>

                    <p className="mt-0.5 max-w-sm text-sm leading-6 text-blue-100/80">
                      {feature.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ---------------- Footer ---------------- */}

        <div className="flex items-center justify-between gap-4">
          <div className="whitespace-nowrap text-[11px] text-blue-100/80 xl:text-sm">
            © 2026 Zoiko Group. All rights reserved.
          </div>

          <div className="flex items-center whitespace-nowrap text-[11px] text-white/90 xl:text-sm">
            {TRUST_BADGES.map((badge, index) => (
              <span key={badge} className="flex items-center">
                {index > 0 && <span className="mx-2 h-3.5 w-px bg-white/30 xl:mx-3" aria-hidden />}
                <HiCheckCircle className="mr-1 text-sm text-sky-400 xl:mr-1.5 xl:text-base" aria-hidden />
                {badge}
              </span>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}
