export function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(\s*(re|fw|fwd)\s*:\s*)+/i, "")
    .trim()
    .toLowerCase();
}

export function uniqueParticipants(addresses: string[]): string[] {
  return [...new Set(addresses.map((address) => address.trim().toLowerCase()))].sort();
}
