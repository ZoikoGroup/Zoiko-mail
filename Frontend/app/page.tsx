"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isLoggedIn, getPlatformToken } from "@/lib/auth-storage";

export default function RootPage() {
  const router = useRouter();
  useEffect(() => {
    if (!isLoggedIn()) {
      router.replace("/login");
    } else if (getPlatformToken()) {
      router.replace("/support");
    } else {
      router.replace("/inbox");
    }
  }, [router]);
  return null;
}
