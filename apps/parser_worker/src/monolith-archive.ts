import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const MONOLITH_BIN = process.env.MONOLITH_BIN ?? "monolith";
const MONOLITH_TIMEOUT_MS = Number(process.env.MONOLITH_TIMEOUT_MS ?? 60000);
const ARCHIVE_DIR = process.env.ARCHIVE_DIR ?? "/data/archive";

function findMonolith(): string | null {
  if (existsSync(MONOLITH_BIN)) return MONOLITH_BIN;
  const paths = ["/usr/local/bin/monolith", "/usr/bin/monolith", "/opt/homebrew/bin/monolith"];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function execMonolith(args: string[], timeoutMs = MONOLITH_TIMEOUT_MS): Promise<{ stdout: string; stderr: string }> {
  const bin = findMonolith();
  if (!bin) throw new Error("monolith not found");

  return new Promise((resolve, reject) => {
    const proc = execFile(bin, args, { timeout: timeoutMs, maxBuffer: 100 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`monolith error: ${err.message}\n${stderr}`));
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
    proc.on("error", reject);
  });
}

export async function isMonolithAvailable(): Promise<boolean> {
  try {
    const bin = findMonolith();
    if (!bin) return false;
    await execMonolith(["--version"], 5000);
    return true;
  } catch {
    return false;
  }
}

export async function archivePage(url: string, itemId: string): Promise<string | null> {
  const outputDir = join(ARCHIVE_DIR, itemId);
  await mkdir(outputDir, { recursive: true });

  const outputPath = join(outputDir, "page.html");

  try {
    await execMonolith([
      url,
      "--output", outputPath,
      "--no-js",
      "--timeout", "30",
      "--isolate"
    ]);

    if (existsSync(outputPath)) {
      return outputPath;
    }
    return null;
  } catch (err) {
    console.warn(`[monolith:failed] ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
