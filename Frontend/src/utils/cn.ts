/**
 * Conditional class joiner. Deliberately dependency-free — the project
 * has no need for clsx or tailwind-merge at this size, and every byte on
 * a credential surface is worth questioning.
 */
export type ClassValue = string | number | null | undefined | false | ClassValue[];

export function cn(...values: ClassValue[]): string {
  const out: string[] = [];

  const walk = (v: ClassValue) => {
    if (!v) return;
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    out.push(String(v));
  };

  values.forEach(walk);
  return out.join(' ');
}
