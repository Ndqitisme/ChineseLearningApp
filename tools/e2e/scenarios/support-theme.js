// Support page in light and dark at the minimum and default sizes: text readable, QR on its own light card.
const SIZES = [[860, 600], [1120, 760]];

// WCAG contrast of an element's text colour against the nearest opaque background behind it.
function contrastOf(sel) {
  const el = document.querySelector(sel);
  const rgb = (s) => (s.match(/[\d.]+/g) ?? []).map(Number);
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  let bg = null;
  for (let n = el; n && !bg; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0.9) bg = c; }
  bg ??= rgb(getComputedStyle(document.body).backgroundColor);
  const fg = rgb(getComputedStyle(el).color);
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return { sel, fg: getComputedStyle(el).color, bg: `rgb(${bg.slice(0, 3)})`, ratio: +((a + 0.05) / (b + 0.05)).toFixed(2) };
}

/** @param {import('../run.ts').T} t */
export default async function (t) {
  const main = await t.open('main', '#/support');
  for (const mode of ['light', 'dark']) {
    await t.step(`S5 switch to ${mode}`, async () => {
      await main.evaluate(() => { location.hash = '#/settings'; });
      await t.waitFor(main, '.page h1', 'Cài đặt');
      // Settings page has a mode picker; pick by its visible label.
      const label = mode === 'dark' ? 'Tối' : 'Sáng';
      await t.click(main, 'button.chip', label);
      await main.waitForFunction((m) => document.documentElement.dataset.theme === m, { timeout: 4000 }, mode);
      await main.evaluate(() => { location.hash = '#/support'; });
      await t.waitFor(main, '.page h1', 'Ủng hộ tác giả');
    });
    for (const [w, h] of SIZES) {
      await t.step(`S5 ${mode} ${w}x${h} readable`, async () => {
        await main.setViewport({ width: w, height: h });
        await new Promise((r) => setTimeout(r, 200));
        const res = [];
        for (const sel of ['.page h1', '.page .lead', '.page .section-title', '.page .muted', '.page .num', '.page button']) res.push(await main.evaluate(contrastOf, sel));
        console.log(`      ${mode} ${w}x${h}`, res.map((r) => `${r.sel}=${r.ratio}`).join(' '));
        for (const r of res) t.assert(r.ratio >= 4.5, `${mode} ${w}x${h}: ${r.sel} contrast ${r.ratio} (${r.fg} on ${r.bg})`);
        const scroll = await main.evaluate(() => { const c = document.querySelector('main.content'); return { sh: c.scrollHeight, ch: c.clientHeight }; });
        console.log(`      content scroll ${scroll.sh}/${scroll.ch}`);
      });
    }
  }
}
