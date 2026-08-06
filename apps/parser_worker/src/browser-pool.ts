const dynamicImport = new Function("modulePath", "return import(modulePath);") as (
  modulePath: string
) => Promise<unknown>;

type Browser = {
  newPage: (options: { userAgent: string }) => Promise<Page>;
  close: () => Promise<void>;
  isConnected?: () => boolean;
};

type Page = {
  setExtraHTTPHeaders?: (headers: Record<string, string>) => Promise<void>;
  setViewportSize?: (viewport: { width: number; height: number }) => Promise<void>;
  waitForTimeout?: (ms: number) => Promise<void>;
  evaluate?: (pageFunction: string | ((arg?: unknown) => unknown), arg?: unknown) => Promise<unknown>;
  goto: (url: string, options: { waitUntil: "domcontentloaded" | "networkidle"; timeout: number; referer?: string }) => Promise<void>;
  url?: () => string;
  content: () => Promise<string>;
  screenshot?: (options: { path?: string; type?: "png" | "jpeg"; quality?: number; fullPage?: boolean }) => Promise<Buffer>;
  pdf?: (options: { path?: string; format?: string; printBackground?: boolean }) => Promise<Buffer>;
  close: () => Promise<void>;
};

type PlaywrightModule = {
  chromium?: {
    launch: (options: { headless: boolean }) => Promise<Browser>;
  };
};

const MAX_POOL_SIZE = Number(process.env.PLAYWRIGHT_POOL_SIZE ?? 2);
const BROWSER_IDLE_TIMEOUT_MS = Number(process.env.PLAYWRIGHT_IDLE_TIMEOUT_MS ?? 60000);

class BrowserPool {
  private pool: Browser[] = [];
  private playwright: PlaywrightModule | null = null;
  private loading: Promise<PlaywrightModule | null> | null = null;
  private idleTimers = new Map<Browser, ReturnType<typeof setTimeout>>();
  private closed = false;

  async getPlaywright(): Promise<PlaywrightModule | null> {
    if (this.playwright) return this.playwright;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const mod = (await dynamicImport("playwright")) as PlaywrightModule;
        this.playwright = mod;
        return mod;
      } catch {
        return null;
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  async acquire(): Promise<Browser> {
    if (this.closed) throw new Error("browser_pool_closed");

    while (this.pool.length > 0) {
      const browser = this.pool.pop()!;
      this.clearIdleTimer(browser);
      if (browser.isConnected?.() !== false) {
        return browser;
      }
      try { await browser.close(); } catch { /* ignore */ }
    }

    const pw = await this.getPlaywright();
    if (!pw?.chromium) throw new Error("playwright_unavailable");
    return pw.chromium.launch({ headless: true });
  }

  release(browser: Browser): void {
    if (this.closed) {
      browser.close().catch(() => {});
      return;
    }
    if (this.pool.length < MAX_POOL_SIZE) {
      this.pool.push(browser);
      this.setIdleTimer(browser);
    } else {
      browser.close().catch(() => {});
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const [browser, timer] of this.idleTimers) {
      clearTimeout(timer);
      try { await browser.close(); } catch { /* ignore */ }
    }
    this.idleTimers.clear();
    for (const browser of this.pool) {
      try { await browser.close(); } catch { /* ignore */ }
    }
    this.pool = [];
  }

  private setIdleTimer(browser: Browser): void {
    const timer = setTimeout(() => {
      const idx = this.pool.indexOf(browser);
      if (idx >= 0) {
        this.pool.splice(idx, 1);
        browser.close().catch(() => {});
      }
      this.idleTimers.delete(browser);
    }, BROWSER_IDLE_TIMEOUT_MS);
    this.idleTimers.set(browser, timer);
  }

  private clearIdleTimer(browser: Browser): void {
    const timer = this.idleTimers.get(browser);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(browser);
    }
  }
}

export const browserPool = new BrowserPool();
export type { Browser, Page, PlaywrightModule };
