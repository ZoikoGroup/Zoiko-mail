"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { OWNER_NAV, OWNER_SECTIONS } from "@/lib/owner-nav";
import type { OwnerNavItem } from "@/lib/owner-nav";
import Image from "next/image";

interface OwnerSidebarProps {
  onNavigate?: () => void;
  role?: string;
}

export function OwnerSidebar({ onNavigate, role }: OwnerSidebarProps) {
  const pathname = usePathname();
  const isOwner = role === "OWNER";

  const visibleNav = OWNER_NAV.filter((item) => !item.ownerOnly || isOwner);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 py-4">
        {/* <img src="/ZoikoMail_Logo_DarkBG_PNG.png" className="h-8 w-auto" alt="Zoiko Mail" /> */}
        <Image src="/ZoikoMail_Logo_DarkBG_PNG.png" width={400} height={100} className="h-10 w-auto" alt="Zoiko Mail" priority />
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {OWNER_SECTIONS.map((section) => {
          const items = visibleNav.filter((n) => n.section === section);
          if (items.length === 0) return null;
          return (
            <div key={section}>
              <div className="font-mono-num px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
                {section}
              </div>
              <div className="space-y-0.5">
                {items.map((n) => (
                  <SidebarRow
                    key={n.href}
                    item={n}
                    active={pathname === n.href}
                    onClick={onNavigate}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </nav>
    </div>
  );
}

function SidebarRow({
  item,
  active,
  onClick,
}: {
  item: OwnerNavItem;
  active: boolean;
  onClick?: () => void;
}) {
  const Icon = item.icon;
  const base = "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition";

  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={`${base} ${
        active
          ? "bg-[var(--accent-soft)] font-medium text-[var(--accent-ink)]"
          : "text-[var(--ink2)] hover:bg-[var(--s2)]"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1">{item.label}</span>
    </Link>
  );
}
