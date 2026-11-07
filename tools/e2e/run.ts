// End-to-end runner: Vite dev server, headless Chrome and a mocked Tauri runtime (tauri-mock.js).
// Fails a scenario on any assertion, console error, uncaught exception, failed request, unmocked
// Tauri command or horizontal scrollbar. Usage: pnpm e2e [name-filter...] (CHROME_PATH sets Chrome).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer, { type BrowserContext, type Page } from 'puppeteer-core';
import { createServer } from 'vite';
import type { Dataset, LevelPack } from '../../src/lib/types.ts';
import { freshProfile, saveProfileAnswer } from '../chrome-profile.ts';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SCENARIO_DIR = 'tools/e2e/scenarios';
const OUT_DIR = '.cache/e2e';
const TIMEOUT = 8000;
// Main window: minimum (src-tauri/src/lib.rs min_inner_size), default (inner_size), and a large one.
const MAIN_SIZES = [{ width: 860, height: 600 }, { width: 1120, height: 760 }, { width: 1600, height: 1000 }];
const MAIN_DEFAULT = MAIN_SIZES[1];
// Pet window starts at 340×330 (src-tauri/src/pet.rs); after that the app sizes it via setSize.
const PET_START = { width: 340, height: 330 };
const MONITOR = {
  name: 'e2e', scaleFactor: 1, position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 },
  workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
};

type Label = 'main' | 'pet';
type Seed = Record<string, Record<string, unknown>>;
/** `system`: what system_state reports at start, e.g. { busy: true } for a fullscreen app already open. */
interface ScenarioModule { default: (t: T) => Promise<void>; seed?: Seed; system?: { busy?: boolean; idleSecs?: number } }

const mockSource = readFileSync('tools/e2e/tauri-mock.js', 'utf8');
const dataset = JSON.parse(readFileSync('src/generated/dataset.json', 'utf8')) as Dataset;
// HSK 4–6 packs, loaded by the app only once unlocked; scenarios read them to know the expected words.
const packs: Partial<Record<4 | 5 | 6, LevelPack>> = {};
for (const level of [4, 5, 6] as const) {
  const file = `src/generated/hsk${level}.json`;
  if (existsSync(file)) packs[level] = JSON.parse(readFileSync(file, 'utf8')) as LevelPack;
}

class AssertionError extends Error {}

/** Everything a scenario gets. Pages are plain puppeteer Pages. */
export class T {
  readonly data = dataset;
  readonly packs = packs;
  readonly pages = new Map<Label, Page>();
  readonly problems: string[] = [];
  private shot = 0;
  private ctx: BrowserContext;
  private base: string;
  private dir: string;
  private seed: Seed | undefined;
  private system: ScenarioModule['system'];

  constructor(ctx: BrowserContext, base: string, dir: string, seed: Seed | undefined, system?: ScenarioModule['system']) {
    this.ctx = ctx;
    this.base = base;
    this.dir = dir;
    this.seed = seed;
    this.system = system;
  }

  /** `loadTimeout` is longer only for the warm-up, when Vite transforms everything cold. */
  async open(label: Label, hash = '', loadTimeout = 30_000): Promise<Page> {
    const page = await this.ctx.newPage();
    this.watch(page, label);
    await page.setViewport(label === 'pet' ? PET_START : MAIN_DEFAULT);
    await page.evaluateOnNewDocument(`(${mockSource})(${JSON.stringify({ label, seed: this.seed ?? null, system: this.system ?? null, monitor: MONITOR })})`);
    await page.goto(`${this.base}/${label === 'pet' ? 'pet' : 'index'}.html${hash}`, { waitUntil: 'domcontentloaded', timeout: loadTimeout });
    await this.waitReady(page, label, loadTimeout);
    this.pages.set(label, page);
    return page;
  }

  async reload(label: Label) {
    const page = this.page(label);
    await page.reload();
    await this.waitReady(page, label);
  }

  /** Runs one user-visible step, then screenshots every open window and checks for overflow. */
  async step(name: string, fn: () => Promise<void>) {
    const started = Date.now();
    try {
      await fn();
      console.log(`    · ${name} (${Date.now() - started} ms)`);
    } catch (err) {
      console.log(`    · ${name} ✗`);
      await this.capture(`FAIL-${name}`);
      throw err;
    }
    await this.capture(name);
    for (const [label, page] of this.pages) this.overflow(label, await horizontalOverflow(page), name);
  }

  assert(cond: unknown, message: string): asserts cond {
    if (!cond) throw new AssertionError(message);
  }

  page(label: Label): Page {
    const p = this.pages.get(label);
    if (!p) throw new Error(`window "${label}" is not open`);
    return p;
  }

  /** Visible text of the first match, or null. */
  text(page: Page, selector: string) {
    return page.$eval(selector, (el) => (el as HTMLElement).innerText.trim()).catch(() => null);
  }
  texts(page: Page, selector: string) {
    return page.$$eval(selector, (els) => els.map((el) => (el as HTMLElement).innerText.trim()));
  }

  /** Waits until `selector` matches (and, if given, its text contains `text`). */
  async waitFor(page: Page, selector: string, text?: string, timeout = TIMEOUT) {
    try {
      await page.waitForFunction(
        (sel, t) => [...document.querySelectorAll(sel)].some((el) => t === null || (el as HTMLElement).innerText.includes(t)),
        { timeout }, selector, text ?? null,
      );
    } catch {
      throw new AssertionError(`timed out waiting for ${selector}${text ? ` containing "${text}"` : ''}`);
    }
  }

  /** Clicks the first element matching `selector` whose text contains `text`. */
  async click(page: Page, selector: string, text?: string) {
    await this.waitFor(page, selector, text);
    const handles = await page.$$(selector);
    for (const h of handles) {
      const t = await h.evaluate((el) => (el as HTMLElement).innerText);
      if (text === undefined || t.includes(text)) return h.click();
    }
    throw new AssertionError(`no ${selector}${text ? ` containing "${text}"` : ''} to click`);
  }

  /** Persisted store file content (settings.json, progress.json), as the next app start would read it. */
  store(page: Page, path: string): Promise<Record<string, any>> {
    return page.evaluate((p) => JSON.parse(localStorage.getItem(`e2e:store:${p}`) ?? '{}'), path);
  }

  /** Tauri commands this window invoked, optionally only `cmd`. */
  calls(page: Page, cmd?: string): Promise<{ cmd: string; args: any }[]> {
    return page.evaluate((c) => (window as any).__e2e.calls.filter((x: { cmd: string }) => !c || x.cmd === c), cmd ?? null);
  }

  /** Emits an app event from `from` to the window `to`, as the Rust side or another window would. */
  emitTo(from: Page, to: Label, event: string, payload: unknown) {
    return from.evaluate((target, e, p) => (window as any).__TAURI_INTERNALS__.invoke('plugin:event|emit_to', { target: { kind: 'AnyLabel', label: target }, event: e, payload: p }), to, event, payload);
  }

  async capture(name: string) {
    await this.syncPetSize();
    this.shot++;
    const safe = name.replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60);
    for (const [label, page] of this.pages) {
      if (!page.isClosed()) await page.screenshot({ path: join(this.dir, `${String(this.shot).padStart(2, '0')}-${label}-${safe}.png`) });
    }
  }

  /** Re-checks every main window at each allowed size. */
  async checkAllSizes() {
    const page = this.pages.get('main');
    if (!page) return;
    const was = page.viewport() ?? MAIN_DEFAULT;
    await page.bringToFront();
    for (const size of MAIN_SIZES) {
      await page.setViewport(size);
      await page.evaluate(() => new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); setTimeout(r, 300); }));
      await page.screenshot({ path: join(this.dir, `size-${size.width}x${size.height}.png`) });
      this.overflow('main', await horizontalOverflow(page), `${size.width}x${size.height}`);
    }
    await page.setViewport(was);
  }

  /** The pet sizes its own window (setSize); mirror that onto the viewport before looking at it. */
  private async syncPetSize() {
    const page = this.pages.get('pet');
    if (!page || page.isClosed()) return;
    const size = await page.evaluate(() => (window as any).__e2e.windowSize as { width: number; height: number } | null);
    const vp = page.viewport();
    if (size && (vp?.width !== Math.round(size.width) || vp?.height !== Math.round(size.height))) {
      await page.setViewport({ width: Math.round(size.width), height: Math.round(size.height) });
    }
  }

  private overflow(label: Label, found: string[], where: string) {
    for (const f of found) this.problems.push(`[${label}] horizontal overflow at ${where}: ${f}`);
  }

  private async waitReady(page: Page, label: Label, timeout = TIMEOUT) {
    await page.waitForSelector(label === 'pet' ? '.stage' : 'nav.side', { timeout });
  }

  private watch(page: Page, label: Label) {
    page.on('console', (m) => { if (m.type() === 'error') this.problems.push(`[${label}] console error: ${m.text()}`); });
    page.on('pageerror', (e) => this.problems.push(`[${label}] uncaught: ${(e as Error).message ?? e}`));
    page.on('requestfailed', (r) => {
      const reason = r.failure()?.errorText ?? '';
      // Aborts come from navigation (reload) cancelling in-flight requests, not from the app.
      if (reason !== 'net::ERR_ABORTED') this.problems.push(`[${label}] request failed: ${r.url()} ${reason}`);
    });
    page.on('response', (r) => {
      if (r.url().endsWith('/favicon.ico')) return;
      if (r.status() >= 400) this.problems.push(`[${label}] HTTP ${r.status()}: ${r.url()}`);
      // Vite answers a missing file with index.html (SPA fallback), status 200.
      else if (r.request().resourceType() !== 'document' && r.headers()['content-type']?.startsWith('text/html')) {
        this.problems.push(`[${label}] missing file (got index.html): ${r.url()}`);
      }
    });
  }
}

/** Elements showing a horizontal scrollbar, and the page itself scrolling sideways. */
function horizontalOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth + 1) out.push(`document ${de.scrollWidth}px > ${de.clientWidth}px`);
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const ox = getComputedStyle(el).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
        const name = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : '');
        out.push(`${name} ${el.scrollWidth}px > ${el.clientWidth}px`);
      }
    }
    return out;
  });
}

async function main() {
  const filters = process.argv.slice(2);
  const files = readdirSync(SCENARIO_DIR).filter((f) => f.endsWith('.js')).sort()
    .filter((f) => !filters.length || filters.some((x) => f.includes(x)));
  if (!files.length) throw new Error(`no scenario matches ${filters.join(' ')}`);
  if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}; set CHROME_PATH`);

  const server = await createServer({ server: { port: 1430, strictPort: false }, logLevel: 'warn', clearScreen: false });
  await server.listen();
  const base = server.resolvedUrls!.local[0].replace(/\/$/, '');
  // A CDP call into a page that never answers (a navigating window) waits out protocolTimeout: 60 s, not the default 180.
  const profile = freshProfile('tieumai-e2e-');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile, protocolTimeout: 60_000, args: [
    '--lang=vi-VN',
    // Both app windows are on screen at once; keep Chrome from throttling the tab that is "behind".
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  ] });

  // Children outlive a stopped shell on Windows, so every run has a deadline and closes Chrome and Vite on a stop signal.
  let closing: Promise<void> | undefined;
  const close = () => (closing ??= browser.close().catch(() => {}).then(() => {
    saveProfileAnswer(profile);
    rmSync(profile, { recursive: true, force: true });
  }).then(() => server.close()));
  const abort = (why: string) => { console.error(`\n${why}: closing Chrome and the app server`); close().finally(() => process.exit(2)); };
  const deadlineMin = Number(process.env.E2E_DEADLINE_MIN) || 20;
  setTimeout(() => abort(`run exceeded ${deadlineMin} min (E2E_DEADLINE_MIN)`), deadlineMin * 60_000).unref();
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(sig, () => abort(sig));

  const results: { scenario: string; ok: boolean; problems: string[]; ms: number }[] = [];
  let navTimeouts = 0;
  try {
    // Vite optimizes dependencies on first load and then reloads the page; let that happen here.
    const warmCtx = await browser.createBrowserContext();
    const warm = new T(warmCtx, base, OUT_DIR, undefined);
    for (const label of ['main', 'pet'] as const) await (await warm.open(label, '', 180_000)).waitForNetworkIdle({ idleTime: 500, timeout: 180_000 });
    await warmCtx.close();

    for (const file of files) {
      const name = file.replace(/\.js$/, '');
      const dir = join(OUT_DIR, name);
      rmSync(resolve(dir), { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      console.log(`▶ ${name}`);
      const mod = (await import(pathToFileURL(resolve(SCENARIO_DIR, file)).href)) as ScenarioModule;
      const ctx = await browser.createBrowserContext();
      const t = new T(ctx, base, dir, mod.seed, mod.system);
      const started = Date.now();
      try {
        await mod.default(t);
        await t.checkAllSizes();
      } catch (err) {
        t.problems.unshift(`${err instanceof AssertionError ? 'assertion' : 'error'}: ${(err as Error).message}`);
      }
      await ctx.close();
      const ms = Date.now() - started;
      results.push({ scenario: name, ok: !t.problems.length, problems: t.problems, ms });
      console.log(t.problems.length ? `  ✗ FAIL (${ms} ms)\n${t.problems.map((p) => `      ${p}`).join('\n')}` : `  ✓ pass (${ms} ms)`);
      // Two scenarios in a row that cannot even load a page mean the app server is gone: the rest would each
      // wait out their timeouts for nothing.
      navTimeouts = t.problems.some((p) => p.includes('Navigation timeout')) ? navTimeouts + 1 : 0;
      if (navTimeouts >= 2) {
        const rest = files.slice(files.indexOf(file) + 1).map((f) => f.replace(/\.js$/, ''));
        console.error(`\nstopped: 2 scenarios in a row could not load the app (server not answering). Not run: ${rest.join(' ') || 'none'}`);
        for (const scenario of rest) results.push({ scenario, ok: false, problems: ['not run: app server stopped answering'], ms: 0 });
        break;
      }
    }
  } finally {
    await close();
  }

  writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed · screenshots in ${OUT_DIR}/<scenario>/`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
