// Resolves where a signed-in user should land based on their backend-assigned role.
// The backend is the source of truth for role determination — never email,
// localStorage, URL parameters, or frontend dropdowns.
export function resolveWorkspaceHref(role?: string): string {
  if (role === "SUPPORT") return "/support";
  // Admin and Owner land on the admin workspace. Owner holds every Admin
  // capability plus more, so /admin is a valid subset view until the Owner
  // workspace exists; the Accountable group is added there later.
  // if (role === "ADMIN" || role === "OWNER") return "/admin";
  if (role === "OWNER") return "/owner";
  if (role === "ADMIN") return "/admin";
  return "/inbox";
}

// Lightweight workspace option for display purposes (no role stored).
export interface WorkspaceOption {
  id: string;
  name: string;
  planCode: string;
}

export const DEFAULT_WORKSPACE_OPTIONS: WorkspaceOption[] = [
  { id: "user", name: "User Workspace", planCode: "starter" },
];