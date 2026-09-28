import { Sandbox } from "@vercel/sandbox";

export const SANDBOX_NAME = "admin-agent";

/** Returns the named sandbox, creating it on first call. */
export async function getSandbox(): Promise<Sandbox> {
  return Sandbox.getOrCreate({
    name: SANDBOX_NAME,
    snapshotExpiration: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
    timeout: 45 * 60 * 1000,                       // 45 min max run time in ms
  });
}

/** Reads memories.md from the sandbox filesystem. Returns null if the file doesn't exist yet. */
export async function readMemories(): Promise<string | null> {
  try {
    const sandbox = await getSandbox();
    const result = await sandbox.readFileToBuffer({ path: "memories.md" });
    return result ? new TextDecoder().decode(result) : null;
  } catch {
    return null;
  }
}
