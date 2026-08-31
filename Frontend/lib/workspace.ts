// Resolves where a signed-in user should land based on their backend-assigned role.
// The backend is the source of truth for role determination — never email,
// localStorage, URL parameters, or frontend dropdowns.
export function resolveWorkspaceHref(role?: string): string {
  // A tenant-scoped SUPPORT member lands on the read-only tenant support
  // page — NOT the global /support platform console (staff only).
  if (role === "SUPPORT") return "/tenant-support";
  // Admin and Owner land on the admin workspace. Owner holds every Admin
  // capability plus more, so /admin is a valid subset view until the Owner
  // workspace exists; the Accountable group is added there later.
  if (role === "OWNER") return "/owner";
  if (role === "ADMIN") return "/admin";
  return "/inbox";
}

/**
 * The user's own workspace: their mailbox, not an administration console.
 *
 * Google sign-in always lands here regardless of role. The admin and owner
 * consoles are entered deliberately from inside the product, so a social
 * sign-in should not drop an Admin straight into a console they did not ask
 * for. Role still decides what those consoles allow once opened; it just no
 * longer decides where a Google sign-in arrives.
 */
export const USER_WORKSPACE_HREF = "/inbox";

// Lightweight workspace option for display purposes (no role stored).
export interface WorkspaceOption {
  id: string;
  name: string;
  planCode: string;
}

export const DEFAULT_WORKSPACE_OPTIONS: WorkspaceOption[] = [
  { id: "user", name: "User Workspace", planCode: "starter" },
];