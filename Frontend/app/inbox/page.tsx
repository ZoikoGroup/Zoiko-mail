// "use client";

// import { useEffect } from "react";
// import { useRouter } from "next/navigation";
// import { isLoggedIn } from "@/lib/auth-storage";
// import { ActionInbox } from "@/components/inbox/ActionInbox";

// export default function InboxPage() {
//   const router = useRouter();
//   useEffect(() => {
//     if (!isLoggedIn()) router.replace("/login");
//   }, [router]);

//   return <ActionInbox />;
// }

"use client";

import { useEffect } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { ActionInbox } from "@/components/inbox/ActionInbox";

export default function InboxPage() {
  useEffect(() => { document.title = "Inbox | Zoiko Mail"; }, []);
  return (
    <AppShell>
      <ActionInbox />
    </AppShell>
  );
}