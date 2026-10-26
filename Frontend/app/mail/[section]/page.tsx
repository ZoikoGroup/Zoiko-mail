"use client";

import { notFound } from "next/navigation";
import { WebmailShell } from "@/components/mail/WebmailShell";
import { ComingSoon } from "@/components/mail/ComingSoon";
import { sectionInfo, type WorkspaceSection } from "@/components/mail/AppRail";

/** The Member workspace sections that are not built yet. (Calendar, Contacts, Tasks and the Work Graph have their own routes.) */
const COMING_SOON: WorkspaceSection[] = ["alet", "help"];

export default function WorkspaceSectionPage({ params }: { params: { section: string } }) {
  const section = params.section as WorkspaceSection;
  if (!COMING_SOON.includes(section)) notFound();
  const info = sectionInfo(section);

  return (
    <WebmailShell section={section}>
      <ComingSoon icon={info.icon} title={info.label} description={info.description} />
    </WebmailShell>
  );
}
