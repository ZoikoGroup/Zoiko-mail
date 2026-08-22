"use client";

import { useEffect } from "react";
import PlatformConsole from "@/components/support/PlatformConsole";

export default function PlatformConsolePage() {
  useEffect(() => { document.title = "Support | Zoiko Mail"; }, []);
  return <PlatformConsole />;
}
