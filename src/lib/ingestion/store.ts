import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Temp staging store for parsed-but-not-committed uploads.
 *
 * Holds the parsed rows between the mapping/validate step and the final commit
 * so the file is uploaded only once. Backed by the OS temp dir in dev; on a
 * serverless deploy this would move to Vercel Blob (private) — the interface
 * stays the same. NOT a durable store; tokens are expected to be short-lived.
 */

const STAGE_DIR = join(tmpdir(), "sales-automation-ingest");

export type StagedUpload = {
  filename: string;
  headers: string[];
  rows: Record<string, string>[];
};

export async function stageUpload(data: StagedUpload): Promise<string> {
  await mkdir(STAGE_DIR, { recursive: true });
  const token = randomUUID();
  await writeFile(join(STAGE_DIR, `${token}.json`), JSON.stringify(data), "utf8");
  return token;
}

export async function readStaged(token: string): Promise<StagedUpload | null> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null; // guard path traversal
  try {
    const raw = await readFile(join(STAGE_DIR, `${token}.json`), "utf8");
    return JSON.parse(raw) as StagedUpload;
  } catch {
    return null;
  }
}

export async function discardStaged(token: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return;
  await unlink(join(STAGE_DIR, `${token}.json`)).catch(() => {});
}
