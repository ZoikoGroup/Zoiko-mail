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

import { AppShell } from "@/components/shell/AppShell";
import { ActionInbox } from "@/components/inbox/ActionInbox";

// The shell handles the auth guard, so the page just composes shell + content.
export default function InboxPage() {
  return (
    <AppShell>
      <ActionInbox />
    </AppShell>
  );
}