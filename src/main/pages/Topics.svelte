<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import Phrases from '../../lib/ui/Phrases.svelte';
  import { glass } from '../../lib/ui/glass/glass.ts';
  import { GROUPS, HSK_HUE, topics } from '../../lib/data.ts';
  import { progress } from '../../lib/progress.svelte.ts';
  import { TARGET_EXPOSURES } from '../../lib/scheduler.ts';
  import { hskIds, setHskOpen, settings, startup, updateSettings } from '../../lib/settings.svelte.ts';
  import { hueVar } from '../../lib/theme/themes.ts';
  import type { HskEdition } from '../../lib/types.ts';
  import { LESSON_SIZE } from '../deck.ts';

  const LEVELS = [1, 2, 3, 4, 5, 6] as const;
  const EDITIONS: HskEdition[] = [2025, 2021];
  /** Level whose pack is loading; 0 when idle. */
  let unlocking = $state(0);
  let failed = $state(false);

  /** Familiar words out of `ids`, and whether any of them was studied at all (shown, marked or reviewed). */
  function progressOf(ids: string[]) {
    let done = 0;
    let started = false;
    for (const id of ids) {
      const e = progress.exposure[id];
      if (e && (e.k || e.n >= TARGET_EXPOSURES)) done++;
      started ||= !!(e && (e.n > 0 || e.k)) || !!progress.srs[id];
    }
    return { done, total: ids.length, started };
  }
  function toggleTopic(id: string) {
    const on = settings.topics.includes(id);
    updateSettings({ topics: on ? settings.topics.filter((t) => t !== id) : [...settings.topics, id] });
  }
  function toggleHsk(level: number) {
    const on = settings.hsk.includes(level);
    updateSettings({ hsk: on ? settings.hsk.filter((l) => l !== level) : [...settings.hsk, level].sort() });
  }
  /** Unlocking is cumulative, so say which lower levels come along. */
  function alsoOpens(level: number) {
    const from = settings.hskOpen + 1;
    if (level === from) return 'Cấp tiếp theo';
    return `Mở kèm HSK ${level - 1 === from ? from : `${from}–${level - 1}`}`;
  }
  async function unlock(level: number) {
    unlocking = level;
    failed = false;
    try { await setHskOpen(level); } catch (e) { console.error(e); failed = true; } finally { unlocking = 0; }
  }
</script>

<div class="page">
  <h1>Chủ đề</h1>
  <p class="lead">Từ vựng theo chủ đề và theo cấp HSK.<br />Bật <Icon name="bell" /> để bảng gợi ý nhắc từ của chủ đề hoặc cấp đó.<br />Đang bật {settings.topics.length} chủ đề và {settings.hsk.length} cấp HSK.</p>

  {#snippet status(p: ReturnType<typeof progressOf>)}
    {#if p.total && p.done === p.total}
      <span class="status full"><Icon name="done" /> Đã quen hết</span>
    {:else if p.started}
      <div class="status">
        <div class="bar"><i style:width="{(p.done / p.total) * 100}%"></i></div>
        <span class="muted small">{p.done}/{p.total} từ đã quen</span>
      </div>
    {:else}
      <span class="status muted small">Chưa học</span>
    {/if}
  {/snippet}

  {#each GROUPS as g (g.id)}
    <h2 class="section-title"><Icon name={g.icon} hue={g.hue} /> {g.title}</h2>
    <div class="grid">
      {#each topics.filter((t) => t.group === g.id) as t (t.id)}
        {@const on = settings.topics.includes(t.id)}
        <div class="card glass glass-lift topic" class:on data-hue={g.hue} style:--h={hueVar(g.hue)} use:glass={{ hover: !on }}>
          <a href="#/topic/{t.id}" class="body">
            <span class="disc"><Icon name={t.icon} /></span>
            <b><Phrases text={t.title} /></b>
            <span class="han zh">{t.titleZh}</span>
            {@render status(progressOf(t.words))}
          </a>
          <button class="bell glass-soft glass-press" class:on onclick={() => toggleTopic(t.id)}
            title={on ? 'Tiểu Mai đang nhắc chủ đề này' : 'Cho Tiểu Mai nhắc chủ đề này'}><Icon name="bell" size="16px" /></button>
        </div>
      {/each}
    </div>
  {/each}

  <h2 class="section-title"><Icon name="books" hue={HSK_HUE} /> Khoá học theo cấp HSK 3.0</h2>
  <div class="row edition">
    <span class="muted small">Bộ từ</span>
    {#each EDITIONS as e (e)}
      <button class="chip glass glass-press" class:on={settings.hskEdition === e} use:glass={{ when: !(settings.hskEdition === e) }} onclick={() => updateSettings({ hskEdition: e })}>Bản {e}</button>
    {/each}
    <a class="small" href="#/settings/hsk">Khác nhau thế nào?</a>
  </div>
  <div class="grid">
    {#each LEVELS as level (level)}
      {#if level <= settings.hskOpen}
        {@const ids = hskIds(level) ?? []}
        {@const on = settings.hsk.includes(level)}
        <div class="card glass glass-lift topic" class:on data-hue={HSK_HUE} style:--h={hueVar(HSK_HUE)} use:glass={{ hover: !on }}>
          <a href="#/hsk/{level}" class="body">
            <span class="disc"><Icon name="course" /></span>
            <b>HSK {level}</b>
            <span class="muted count">{ids.length} từ</span>
            <span class="muted small">{Math.ceil(ids.length / LESSON_SIZE)} bài, mỗi bài {LESSON_SIZE} từ</span>
            {@render status(progressOf(ids))}
          </a>
          <button class="bell glass-soft glass-press" class:on onclick={() => toggleHsk(level)}
            title={on ? 'Tiểu Mai đang nhắc cấp này' : 'Cho Tiểu Mai nhắc cấp này'}><Icon name="bell" size="16px" /></button>
        </div>
      {:else}
        <div class="card glass topic locked" use:glass={{ hover: true }}>
          <span class="disc"><Icon name="lock" /></span>
          <b>HSK {level}</b>
          <span class="muted small">{alsoOpens(level)}</span>
          <button use:glass class="btn glass glass-press" disabled={!!unlocking} onclick={() => unlock(level)}>{unlocking === level ? 'Đang tải…' : 'Mở khoá'}</button>
        </div>
      {/if}
    {/each}
  </div>
  {#if settings.hskOpen < 6}
    <p class="muted small unlock-note">Có thể khoá lại các cấp đã mở trong <a href="#/settings/hsk">Cài đặt</a>.<br />Tiến độ ôn tập vẫn được giữ.</p>
  {/if}
  {#if failed}<p class="small bad">Không mở khoá được. Hãy thử lại.</p>
  {:else if startup.failedLevel > settings.hskOpen}<p class="small bad">Không đọc được dữ liệu HSK {startup.failedLevel} khi khởi động nên cấp này đã bị khoá. Hãy mở khoá lại.</p>{/if}
</div>

<style>
  .topic { position: relative; padding: 16px 18px; display: flex; flex-direction: column; }
  /* On: the whole card takes its group colour, so the topics Tiểu Mai uses stand out in the grid. */
  /* On: the group hue as a tint and as a 2px inner ring (the rim just inside it), so the state reads even where the tint
     mixes toward grey on a theme of the opposite hue. */
  /* The arc fades within the corner (a third of the width, under half the height) and takes the group hue: spread over
     the long edges of a card, an even grey band read as a second border inside the ring. */
  .topic { --arc-inset: 2px; --arc-r: var(--radius); --arc-size: 32% 44%; --arc-tint: var(--h); }
  .topic.on { --glass-tint: color-mix(in srgb, var(--h) var(--topic-on-tint), var(--surface)); --glass-alpha: 64%; --glass-rim-w: 3px;
    box-shadow: inset 0 0 0 2px var(--h), var(--glass-rim), var(--glass-shadow, var(--shadow)); }
  /* Light: more of the hue, so it is not cancelled to grey by a backdrop of the opposite hue (teal over Hoa anh đào's pink). */
  :global(:root) { --topic-on-tint: 30%; }
  :global(:root[data-theme='light']) { --topic-on-tint: 24%; }
  /* Dark orange: mixed with the blue or violet surface it turns brown or rose, and lightening it lost the muted text's
     4.5:1. Mixed toward black in oklab it keeps its own hue and stays dark; dense, so the backdrop does not pull it back. */
  :global(:root[data-theme='dark']) .topic.on[data-hue='orange'] { --glass-tint: color-mix(in oklab, var(--h) 40%, black); --glass-alpha: 88%; }
  /* Teal on Đêm sao's violet surface turns petrol blue, next to the blue group's slate: the same treatment as orange. */
  :global(:root[data-theme-id='night'][data-theme='dark']) .topic.on[data-hue='teal'] { --glass-tint: color-mix(in oklab, var(--h) 40%, black); --glass-alpha: 88%; }
  /* Teal over Hoa anh đào's pink blobs turns grey (HSL saturation 0.06): mixed toward white in oklab and denser, it keeps
     its own hue whatever shows through. */
  :global(:root[data-theme-id='sakura'][data-theme='light']) .topic.on[data-hue='teal'] { --glass-tint: color-mix(in oklab, var(--h) 32%, white); --glass-alpha: 86%; }
  /* --text-2 alone drops under 4.5:1 on the tint (sakura light). */
  .topic.on .muted { color: color-mix(in srgb, var(--text-2) 65%, var(--text)); }
  /* The 12px lines on the tint: their thin strokes render weaker than the colour (stroke core 4.3-4.4:1 on Hoa anh đào's
     teal card in light, and on the solid tint under reduced transparency in dark). */
  .topic.on .muted.small { color: color-mix(in srgb, var(--text-2) 25%, var(--text)); }
  /* Keyboard focus on the card's link rings the whole card, following its corners. */
  .body:focus-visible { outline: none; }
  .topic:has(.body:focus-visible) { outline: 2px solid var(--primary-ink); outline-offset: 2px; }
  .body { flex: 1; display: flex; flex-direction: column; align-items: flex-start; gap: 3px; color: var(--text); text-decoration: none; }
  .disc { font-size: 26px; margin-bottom: 4px; }
  .locked .disc { --h: var(--text-2); }
  .zh { color: var(--text-2); font-size: 16px; }
  /* Light: the thin Kai strokes reach 3.5-3.7:1 in --text-2 (stroke core). Nearly half the text colour and the hairline
     stroke the pinyin uses: 5.0-5.3:1. */
  :global(:root[data-theme='light']) .zh { color: color-mix(in srgb, var(--text-2) 55%, var(--text)); -webkit-text-stroke: 0.25px currentColor; }
  /* On a selected card three quarters of the text colour, in light and dark: the stroke core read 3.8:1 on Hoa anh đào's
     teal card in light and 4.4:1 on its solid tint under reduced transparency in dark. */
  :global(:root) .topic.on .zh { color: color-mix(in srgb, var(--text-2) 25%, var(--text)); }
  .status { align-self: stretch; margin-top: auto; padding-top: 8px; }
  /* Its own line box, so the caption under a bar sits on the same baseline as "Chưa học" in the next card. */
  .status .small { display: block; }
  .full { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 800; }
  .full :global(.icon) { color: var(--good); }
  /* Track at 12 % of the hue over the surface, opaque: at 18 %, or see-through over the tint of a selected card, the fill
     fell under 3:1 against it on the solid card (reduced transparency). */
  .bar { height: 7px; background: color-mix(in srgb, var(--h) 12%, var(--surface)); border-radius: 99px; overflow: hidden; margin-bottom: 3px; box-shadow: inset 0 1px 2px rgb(var(--glass-black) / .12); }
  .bar i { display: block; height: 100%; background: var(--h); border-radius: 99px; box-shadow: inset 0 1px 0 rgb(var(--glass-white) / .35); }
  .small { font-size: 12px; }
  .bell {
    /* Concentric with the card corner where the theme radius allows (inset = card radius − bell radius), else 4px in.
       The icon is 16px (size prop), so its box stays inside the circle's lit rim. */
    position: absolute; top: max(4px, calc(var(--radius) - 15px)); right: max(4px, calc(var(--radius) - 15px)); border: 0; color: var(--text-2);
    border-radius: 99px; width: 30px; height: 30px;
    --glass-tint: var(--surface-2); --glass-alpha: 70%;
  }
  /* Light, refracting: the bells skip the filter (22 cards; CPU) but carry the look it gives the plain pills on white
     cards, the --primary-fill tint at the outer bezel (BEZEL_TINT, 18 %, fading inward over 6px) and the lit rim
     (LIGHT_SPECULAR, .9) along the upper left. */
  @media (prefers-reduced-transparency: no-preference) {
    :global(:root[data-glass='refract'][data-theme='light']) .bell:not(.on) {
      background-image: radial-gradient(circle closest-side, transparent 60%, color-mix(in srgb, var(--primary-fill) 4%, transparent) 80%, color-mix(in srgb, var(--primary-fill) 18%, transparent) 100%);
      box-shadow: var(--glass-rim), inset 1.5px 2px 2.5px -1px rgb(var(--glass-white) / calc(var(--glass-rim-hi) * .9)), var(--glass-shadow, var(--shadow));
    }
  }
  /* Filled bell: the rim is a lighter tint of its own hue, not the neutral hairline. */
  .bell.on { --glass-rim-dark: 0%; }
  /* Filled: a solid circle in the group colour; --surface on it is the same 3:1+ pair as the hue on --surface. */
  .bell.on { --glass-tint: var(--h); --glass-alpha: 100%; color: var(--surface); }
  /* Hover on the bell itself (not the card): the group hue comes in, the glass gets denser, the shadow wider. */
  .bell:hover:not(.on) { --glass-tint: color-mix(in srgb, var(--h) 16%, var(--surface)); --glass-alpha: 95%; color: color-mix(in srgb, var(--h) 80%, var(--text)); }
  .bell.on:hover { --glass-tint: color-mix(in srgb, var(--h) 85%, var(--text)); }
  .bell:hover { --glass-shadow: 0 2px 4px rgb(var(--glass-black) / .14), 0 6px 14px rgb(var(--glass-black) / .14); }
  /* Filled: the per-edge rim is offset by a pixel, which on a 30px disc of solid colour draws a pale crescent (two
     discs out of register). A centred ring and a sheen clipped to the disc instead. */
  .bell.on { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--h) 65%, white), var(--glass-shadow); background-image: radial-gradient(circle at 50% 0%, rgb(var(--glass-white) / .3), transparent 60%); }
  /* Pressed: the glass sinks (inner shadow, dimmer rim) but stays outlined, also on the light card. */
  .bell:active { --glass-rim-hi: .5; --glass-rim-mid: .3; --glass-rim-dark: 40%; --glass-shadow: inset 0 2px 4px rgb(var(--glass-black) / .2), 0 1px 1px rgb(var(--glass-black) / .1); }
  .bell.on:active { --glass-tint: var(--h); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--h) 70%, black), inset 0 2px 4px rgb(var(--glass-black) / .25); }
  /* Dark: the light disc sinks under a black wash, as the pills do. */
  :global(:root[data-theme='dark']) .bell.on:active { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--h) 70%, black), inset 0 2px 4px rgb(var(--glass-black) / .25), inset 0 0 0 100vmax rgb(var(--glass-black) / .2); }
  /* Inside the disc: 2px out it ran over the card's own state ring at the corner. */
  .bell:focus-visible { outline-offset: -3px; }
  /* On the filled disc the ring takes the icon's colour, with a pixel of the hue outside it: the ink colour on the hue
     was a colour swap of under 2:1. */
  .bell.on:focus-visible { outline-color: var(--surface); }
  .locked { display: flex; flex-direction: column; gap: 3px; align-items: flex-start; }
  .locked .btn { margin-top: 8px; }
  /* Clear of the card shadows above, which would sit under the muted text. */
  .unlock-note { margin-top: 24px; }
  .edition { flex-wrap: wrap; gap: 8px; margin: -4px 0 14px; }
  .edition a { margin-left: 6px; }
</style>
