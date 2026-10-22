import { AcceptInvitationScreen } from "@/components/auth/AcceptInvitationScreen";

/**
 * Where invitation links pointed before /invitation/accept. Kept so links
 * already sent keep working; it is the same screen.
 */
export default function AcceptInvitationPage() {
  return <AcceptInvitationScreen />;
}
