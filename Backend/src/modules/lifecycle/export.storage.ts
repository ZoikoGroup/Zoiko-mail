import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import { env } from "../../config/env.js";

class ExportStorage {
  private readonly root = resolve(
    isAbsolute(env.EXPORT_STORAGE_PATH)
      ? env.EXPORT_STORAGE_PATH
      : resolve(process.cwd(), env.EXPORT_STORAGE_PATH)
  );

  private path(storageKey: string) {
    const filePath = resolve(this.root, storageKey);
    if (!filePath.startsWith(`${this.root}${sep}`)) throw new Error("Invalid export storage key");
    return filePath;
  }

  async save(data: Buffer) {
    await mkdir(this.root, { recursive: true });
    const storageKey = `${randomUUID()}.json`;
    await writeFile(this.path(storageKey), data, { flag: "wx" });
    return {
      storageKey,
      sizeBytes: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
    };
  }

  read(storageKey: string) {
    return readFile(this.path(storageKey));
  }

  delete(storageKey: string) {
    return rm(this.path(storageKey), { force: true });
  }

  async check() {
    await mkdir(this.root, { recursive: true });
    await access(this.root, constants.R_OK | constants.W_OK);
  }
}

export const exportStorage = new ExportStorage();
