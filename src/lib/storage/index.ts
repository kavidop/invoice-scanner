import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

/**
 * Where original invoice documents live. Local disk for now; swap for
 * Vercel Blob / S3 / R2 before deploying to a serverless host.
 */
export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

class LocalDiskStorage implements FileStorage {
  constructor(private readonly root: string) {}

  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error(`Invalid storage key: ${key}`);
    return full;
  }

  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async get(key: string) {
    try {
      return await readFile(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
}

let storage: FileStorage | undefined;

export function fileStorage(): FileStorage {
  storage ??= new LocalDiskStorage(env().UPLOAD_DIR);
  return storage;
}
