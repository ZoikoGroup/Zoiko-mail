// Resolves where a signed-in user should land based on their backend-assigned role.
// The backend is the source of truth for role determination — never email,
// localStorage, URL parameters, or frontend dropdowns.
export function resolveWorkspaceHref(role?: string): string {
  if (role === "SUPPORT") return "/support-workspace";
  if (role === "OWNER" || role === "ADMIN" || role === "MEMBER") return "/inbox";
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