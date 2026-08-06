import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const YTDLP_BIN = process.env.YTDLP_BIN ?? "yt-dlp";
const YTDLP_TIMEOUT_MS = Number(process.env.YTDLP_TIMEOUT_MS ?? 120000);
const ARCHIVE_DIR = process.env.ARCHIVE_DIR ?? "/data/archive";

export type YtdlpResult = {
  videoPath?: string;
  audioPath?: string;
  infoJson?: Record<string, unknown>;
  title?: string;
  duration?: number;
  thumbnail?: string;
};

function findYtdlp(): string | null {
  if (existsSync(YTDLP_BIN)) return YTDLP_BIN;
  const paths = ["/usr/local/bin/yt-dlp", "/usr/bin/yt-dlp", "/opt/homebrew/bin/yt-dlp"];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function execYtdlp(args: string[], timeoutMs = YTDLP_TIMEOUT_MS): Promise<{ stdout: string; stderr: string }> {
  const bin = findYtdlp();
  if (!bin) throw new Error("yt-dlp not found");

  return new Promise((resolve, reject) => {
    const proc = execFile(bin, args, { timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`yt-dlp error: ${err.message}\n${stderr}`));
      else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
    proc.on("error", reject);
  });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9\u4e00-\u9fff._-]/g, "_").slice(0, 100);
}

export async function isYtdlpAvailable(): Promise<boolean> {
  try {
    const bin = findYtdlp();
    if (!bin) return false;
    await execYtdlp(["--version"], 5000);
    return true;
  } catch {
    return false;
  }
}

export async function extractVideoInfo(url: string): Promise<YtdlpResult | null> {
  try {
    const { stdout } = await execYtdlp([
      "--dump-json",
      "--no-download",
      "--no-warnings",
      "--no-check-certificates",
      url
    ]);
    const info = JSON.parse(stdout);
    return {
      title: info.title,
      duration: info.duration,
      thumbnail: info.thumbnail,
      infoJson: info
    };
  } catch (err) {
    console.warn(`[ytdlp:info-failed] ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function downloadVideo(url: string, itemId: string): Promise<YtdlpResult | null> {
  const outputDir = join(ARCHIVE_DIR, itemId);
  await mkdir(outputDir, { recursive: true });

  const outputTemplate = join(outputDir, "%(title).80s.%(ext)s");
  const infoJsonPath = join(outputDir, "info.json");

  try {
    const { stdout } = await execYtdlp([
      "--format", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
      "--merge-output-format", "mp4",
      "--write-info-json",
      "--write-thumbnail",
      "--no-warnings",
      "--no-check-certificates",
      "--output", outputTemplate,
      "--print", "after_move:filepath",
      url
    ]);

    const lines = stdout.trim().split("\n").filter(Boolean);
    const videoPath = lines[lines.length - 1];

    let infoJson: Record<string, unknown> | undefined;
    try {
      if (existsSync(infoJsonPath)) {
        const { readFile } = await import("node:fs/promises");
        infoJson = JSON.parse(await readFile(infoJsonPath, "utf-8"));
      }
    } catch { /* ignore */ }

    return {
      videoPath: videoPath || undefined,
      title: infoJson?.title as string | undefined,
      duration: infoJson?.duration as number | undefined,
      thumbnail: infoJson?.thumbnail as string | undefined,
      infoJson
    };
  } catch (err) {
    console.warn(`[ytdlp:download-failed] ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export function supportsYtdlp(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const supportedDomains = [
      "youtube.com", "youtu.be", "bilibili.com", "b23.tv",
      "douyin.com", "iesdouyin.com", "tiktok.com",
      "weibo.com", "weibo.cn", "instagram.com",
      "x.com", "twitter.com", "reddit.com",
      "vimeo.com", "dailymotion.com", "twitch.tv",
      "kuaishou.com", "ixigua.com"
    ];
    return supportedDomains.some((d) => host.endsWith(d));
  } catch {
    return false;
  }
}
