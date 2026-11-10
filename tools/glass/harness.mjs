// Shared harness for the glass proofs: Vite dev server + headless Chrome (fresh profile through
// tools/chrome-profile.ts, mandatory on this machine) + the e2e Tauri mock injected before app code.
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO = fileURLToPath(new URL('../..', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
/** Shots and measurements go here (ignored by git). */
export const WORK = `${REPO}/.cache/glass`;
mkdirSync(WORK, { recursive: true });
process.chdir(REPO);
const puppeteer = (await import(pathToFileURL(`${REPO}/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js`).href)).default;
const { createServer } = await import(pathToFileURL(`${REPO}/node_modules/vite/dist/node/index.js`).href);
const { freshProfile, saveProfileAnswer } = await import(pathToFileURL(`${REPO}/tools/chrome-profile.ts`).href);

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MONITOR = {
  name: 'shoot', scaleFactor: 1, position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 },
  workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
};
const mockSource = readFileSync('tools/e2e/tauri-mock.js', 'utf8');
export const data = JSON.parse(readFileSync('src/generated/dataset.json', 'utf8'));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function start() {
  const server = await createServer({ server: { port: 1437, strictPort: false }, logLevel: 'warn', clearScreen: false });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const profile = freshProfile('tieumai-glass-');
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, userDataDir: profile, protocolTimeout: 60_000,
    args: ['--lang=vi-VN', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--hide-scrollbars'],
  });
  console.log('chrome pid', browser.process()?.pid, 'server', base);
  let closing;
  const close = () => (closing ??= browser.close().catch(() => {}).then(() => {
    saveProfileAnswer(profile);
    rmSync(profile, { recursive: true, force: true });
  }).then(() => server.close()));
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => close().finally(() => process.exit(2)));
  setTimeout(() => { console.error('deadline: closing'); close().finally(() => process.exit(2)); }, 25 * 60_000).unref();

  /** Opens a window in a fresh context (fresh stores), seeded, at `size`. */
  async function open({ label = 'main', hash = '', query = '', size = { width: 860, height: 600 }, seed = null, media = [], system = null }) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    const errors = [];
    // Resource failures are reported by URL from the response listener (favicon excluded).
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(`uncaught: ${e.message ?? e}`));
    page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`HTTP ${r.status()} ${r.url()}`); });
    await page.setViewport(label === 'pet' ? { width: 340, height: 330 } : size);
    // Headless Chrome follows the Windows "animation effects" setting for prefers-reduced-motion, which changed
    // between runs on this machine; pin it unless a shot asks for the reduced version.
    const features = [{ name: 'prefers-reduced-motion', value: 'no-preference' }, ...media].filter((f, i, all) => all.findLastIndex((g) => g.name === f.name) === i);
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setEmulatedMedia', { features });
    await page.evaluateOnNewDocument(`(${mockSource})(${JSON.stringify({ label, seed, system, monitor: MONITOR })})`);
    await page.goto(`${base}/${label === 'pet' ? 'pet' : 'index'}.html${query}${hash}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForSelector(label === 'pet' ? '.stage' : 'nav.side', { timeout: 120_000 });
    const close = () => ctx.close();
    return { page, ctx, errors, close };
  }

  /** The pet sizes its own window; mirror that onto the viewport. */
  async function syncPet(page) {
    const size = await page.evaluate(() => window.__e2e.windowSize);
    if (size) await page.setViewport({ width: Math.round(size.width), height: Math.round(size.height) });
  }

  /** Waits for fonts, the glass maps (80 ms debounce) and two frames. */
  async function settle(page, ms = 350) {
    await page.evaluate(() => document.fonts.ready);
    await sleep(ms);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }

  return { browser, base, open, syncPet, settle, close };
}

/** Settings seed for a theme/mode. */
export function seedFor({ theme = 'ocean', mode = 'light', settings = {}, progress }) {
  const greetings = data.topics.find((t) => t.id === 'greetings').words;
  const numbers = data.topics.find((t) => t.id === 'numbers-money').words;
  const exposure = {};
  greetings.slice(0, 8).forEach((id, i) => { exposure[id] = { n: 3 + i, t: 1000 + i, ...(i < 3 ? { s: 1 } : {}), ...(i === 7 ? { k: 1 } : {}) }; });
  numbers.slice(0, 4).forEach((id, i) => { exposure[id] = { n: 1, t: 2000 + i }; });
  const srs = {};
  for (const id of greetings.slice(0, 3)) srs[id] = { due: '2020-01-01T00:00:00Z', stability: 2, difficulty: 5, elapsed_days: 0, scheduled_days: 1, learning_steps: 0, reps: 2, lapses: 0, state: 2 };
  const today = new Date().toISOString().slice(0, 10);
  return {
    'settings.json': { settings: { settingsVersion: 4, onboarded: true, theme, mode, petEnabled: true, hskOpen: 3, showExample: true, showHanviet: true, ...settings } },
    'progress.json': progress ?? { exposure, srs, seenDays: { [today]: 14 }, reviewDays: { [today]: 5 } },
  };
}
