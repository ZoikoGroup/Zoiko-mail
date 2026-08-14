/** Small formatting helpers. Kept pure so they are trivially testable. */

/** mm:ss for the account-lock countdown. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** Two-digit state index for the provenance strip. */
export function padIndex(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/**
 * Masks a local part for display in recovery options.
 * Never used to decide anything — only to avoid printing an address in full.
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '•••';
  const head = local.slice(0, 1);
  return `${head}•••@${domain}`;
}

/** Title-cases a role for display without changing the stored value. */
export function displayRole(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
