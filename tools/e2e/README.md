# End-to-end tests

`pnpm e2e` starts the Vite dev server, opens the app's two windows (`index.html` = main,
`pet.html` = assistant) in headless Chrome and runs every scenario in `scenarios/`. A fake Tauri
runtime (`tauri-mock.js`) is injected before any app code, so no Rust build is needed.

```sh
pnpm e2e                      # every scenario
pnpm e2e quiz review          # only files whose name contains "quiz" or "review"
CHROME_PATH=/path/to/chrome pnpm e2e
```

Needs Google Chrome installed (default `C:/Program Files/Google/Chrome/Application/chrome.exe`).
It uses its own port (1430 or the next free one), so a running `pnpm tauri dev` is fine.

Every script that launches Chrome, here or elsewhere, creates its profile with `freshProfile` and calls
`saveProfileAnswer` after Chrome closes (`tools/chrome-profile.ts`): each new Chrome profile on Windows tries
to log on with a blank password, and ten tries in ten minutes lock the user's account.

Puppeteer's `waitFor`/`click` poll on animation frames, which only run in the front tab: call
`page.bringToFront()` on a window before waiting on it when the other window was used last.

A run never outlives its job. Chrome and the dev server are closed on Ctrl+C or a stop signal, and when the
run passes its deadline: 20 minutes, or `E2E_DEADLINE_MIN` (exit code 2). If two scenarios in a row cannot
load a page, the dev server has stopped answering: the run stops there and lists the scenarios it did not run.

Output:

- `.cache/e2e/<scenario>/NN-<window>-<step>.png`: one screenshot per step and window;
  `FAIL-<step>` when a step throws; `size-WxH.png` for the size sweep at the end.
- `.cache/e2e/results.json`: pass/fail and every problem per scenario.
- Exit code 1 if any scenario failed.

## What fails a scenario

The scenario's own assertions, plus these, collected on every window:

| Problem | How it is caught |
|---|---|
| Console error | `console.error` from app or library code |
| Uncaught exception | `pageerror` |
| Failed request | network failure (except aborts caused by a reload), HTTP status ≥ 400 |
| Missing file | a non-document request answered with `text/html`, which is Vite's index.html fallback for a file that does not exist |
| Unmocked Tauri command | the mock throws and logs a console error, so the run fails |
| Horizontal overflow | the page, or any element with `overflow-x: auto/scroll`, wider than its box: after every step at the current size, and at the end in the main window at 860×600 (minimum), 1120×760 (default) and 1600×1000 |

Text cut off with `overflow: hidden` on purpose (ellipsis) is not flagged.

## Writing a scenario

A scenario is one `.js` file in `scenarios/`. It default-exports `async (t) => {}` and can
export a `seed` for the stores. Each scenario gets a fresh browser profile, so stores start empty
(or as seeded). It can also export `system` (`{ busy, idleSecs }`) to set what `system_state`
reports from the first call, in every window and again after a reload.

```js
// Review: a due card flips and a grade schedules it.
export const seed = { 'progress.json': { srs: { 学生: { due: '2020-01-01T00:00:00Z', /* … */ } } } };

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/review');
  await t.step('flip shows the meaning', async () => {
    await main.click('.flash');
    await t.waitFor(main, '.back .vi', 'học sinh');
  });
}
```

Assert on what the learner sees (text, classes that change the look, the saved store), not on
component internals. Look up the expected values in `t.data` instead of hard-coding them where
the data may change.

`t` (class `T` in `run.ts`):

| Member | Does |
|---|---|
| `open(label, hash?)` | opens `'main'` (1120×760) or `'pet'` (sized by the app's own `setSize`) and waits for the app to mount; returns a puppeteer `Page` |
| `reload(label)` | reloads a window and waits for it to mount again; stores survive |
| `step(name, fn)` | runs `fn`, then screenshots every window and checks overflow |
| `assert(cond, msg)` | fails the scenario with `msg` |
| `waitFor(page, selector, text?, timeout?)` | waits until a match (containing `text`) exists; 8 s by default |
| `click(page, selector, text?)` | clicks the first match containing `text` |
| `text(page, selector)` / `texts(page, selector)` | visible text (`innerText`, so CSS `text-transform` applies) |
| `store(page, path)` | saved content of an app store file, `'settings.json'` or `'progress.json'` |
| `calls(page, cmd?)` | Tauri commands that window invoked, `{ cmd, args }` |
| `emitTo(page, label, event, payload)` | sends an app event to a window, like Rust or the other window would (e.g. tray `'next'`) |
| `data` | `src/generated/dataset.json` (the core, HSK 1–3) |
| `packs` | `src/generated/hsk4/5/6.json` when they exist, keyed by level |

Both windows are on screen together in the real app, so Chrome runs with background throttling
off; timers and animation frames run in both pages.

## Mock contract

`tauri-mock.js` defines `window.__TAURI_INTERNALS__` (`invoke`, `transformCallback`,
`metadata.currentWindow.label`, …) and `window.__TAURI_EVENT_PLUGIN_INTERNALS__`, which is all
`@tauri-apps/api` and the plugins call into. Args go through a JSON round trip, as real IPC does,
so `LogicalSize`/`PhysicalPosition` arrive in their wire form (`{ Logical: { width, height } }`).

State visible to scenarios is on `window.__e2e`: `calls`, `unknown`, `hitRects`, `windowSize`,
and the knobs `system` (`{ busy, idleSecs }`), `autostart`, `dialogResult`.

| Command | Mock behaviour |
|---|---|
| `open_main { route }` | emits `main:navigate` with `route` to the main window (as `lib.rs` does when it is open) |
| `pet_set_hit_rects { rects }` | stored in `__e2e.hitRects` |
| `system_state` | returns `__e2e.system` (default not busy, 0 s idle, or the scenario's `system` export) |
| `tts_http`, `voicepack_info`, `voicepack_clip` | reject: no voices in tests |
| `plugin:event\|listen/unlisten/emit/emit_to` | real delivery inside the window; `emit` reaches every window, `emit_to` only the named one, across windows via `BroadcastChannel` |
| `store_load { name }` | returns the saved object for `'settings.json'` or `'progress.json'` from `localStorage` (`e2e:store:<name>`) |
| `store_set { name, key, value }` | saves to `localStorage` and fires `store:change` with `{ name, key, value }` in every window, the writer included, like `store.rs`. `localStorage` stands in for the Rust process, so data survives a reload |
| `plugin:resources\|close` | no-op |
| `plugin:opener\|open_url/open_path/reveal_item_in_dir` | recorded only |
| `plugin:autostart\|is_enabled/enable/disable` | flips `__e2e.autostart` |
| `plugin:dialog\|open/save` | returns `__e2e.dialogResult` (default `null`, i.e. cancelled); `message` no-op |
| `plugin:window\|show/hide/minimize/toggle_maximize/close/start_dragging` | recorded only |
| `plugin:window\|scale_factor` | `1` |
| `plugin:window\|outer_position/set_position` | tracks a position; a change fires `tauri://move` (`onMoved`) |
| `plugin:window\|outer_size/set_size` | tracks a size in `__e2e.windowSize`; the runner applies it to the pet viewport before each screenshot |
| `plugin:window\|primary_monitor`, `monitor_from_point` | one 1920×1080 monitor, work area 1920×1040, scale 1 |
| anything else | throws `[e2e] unmocked Tauri command: <cmd>` and logs it, so the run fails |

When the app starts calling a new command or plugin, add a handler in `tauri-mock.js` and a row
here, with behaviour close to the Rust side.
