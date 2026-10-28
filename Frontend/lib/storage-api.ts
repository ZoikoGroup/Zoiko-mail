import { apiRequest } from "./api-client";

export interface StorageFolder {
  folder: string;
  messages: number;
  bytes: number;
}

export interface StorageMessage {
  id: string;
  subject: string;
  folder: string;
  from: string | null;
  date: string;
  bytes: number;
  attachments: number;
}

/** Where the signed-in member's mailbox storage went. */
export interface StorageOverview {
  address: string;
  usedBytes: number;
  limitBytes: number;
  freeBytes: number;
  /** At the limit: new mail cannot be stored and attachments are refused. */
  full: boolean;
  /** What the folders add up to, which can differ from usedBytes until Recalculate is run. */
  itemisedBytes: number;
  folders: StorageFolder[];
  attachments: { files: number; bytes: number };
  largest: StorageMessage[];
}

export function getStorage(): Promise<StorageOverview> {
  return apiRequest<StorageOverview>("/mail/storage");
}

export function recalculateStorage(): Promise<StorageOverview> {
  return apiRequest<StorageOverview>("/mail/storage/recalculate", { method: "POST" });
}

/** "1.2 GB", "340 MB", "12 KB", "0 B" — the largest unit that keeps the number above 1. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}
