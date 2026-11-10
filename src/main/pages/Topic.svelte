<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import { glass, LIGHT_SPECULAR } from '../../lib/ui/glass/glass.ts';
  import { theme } from '../../lib/theme/apply.svelte.ts';
  import BackButton from '../components/BackButton.svelte';
  import { HSK_HUE, topicById, topicHue } from '../../lib/data.ts';
  import { progress } from '../../lib/progress.svelte.ts';
  import { TARGET_EXPOSURES } from '../../lib/scheduler.ts';
  import { hskIds, openWord, setHskOpen, settings } from '../../lib/settings.svelte.ts';
  import { HUE_OF, hueVar } from '../../lib/theme/themes.ts';
  import type { HskLevel, Word } from '../../lib/types.ts';
  import WordRow from '../components/WordRow.svelte';
  import { LESSON_SIZE } from '../deck.ts';

  let { kind, id }: { kind: string; id: string } = $props();

  const info = $derived.by(() => {
    if (kind === 'topic') {
      const t = topicById.get(id);
      return t ? { icon: t.icon, hue: topicHue(t), title: t.title, zh: t.titleZh, ids: t.words, deck: `topic/${t.id}` } : null;
    }
    const ids = /^[1-6]$/.test(id) && +id <= settings.hskOpen ? hskIds(+id as HskLevel) : undefined;
    return ids ? { icon: 'course' as const, hue: HSK_HUE, title: `HSK ${id}`, zh: '', ids, deck: `hsk/${id}` } : null;
  });
  let filter = $state('');
  let unlocking = $state(false);
  let failed = $state(false);
  async function unlock() {
    unlocking = true;
    failed = false;
    try { await setHskOpen(+id); } catch (e) { console.error(e); failed = true; } finally { unlocking = false; }
  }
  const matches = (w: Word) => !filter || w.hanzi.includes(filter) || w.vi.toLowerCase().includes(filter.toLowerCase());
  const toWords = (ids: string[]) => ids.map((i) => openWord(i)).filter((w): w is Word => !!w);
  const list = $derived(toWords(info?.ids ?? []).filter(matches));
  /** HSK only: LESSON_SIZE-id slices in frequency order, the same ones deck.ts serves. */
  const lessons = $derived.by(() => {
    if (kind !== 'hsk' || !info) return [];
    const out = [];
    for (let i = 0; i < info.ids.length; i += LESSON_SIZE) {
      const all = toWords(info.ids.slice(i, i + LESSON_SIZE));
      const learned = all.filter((w) => { const e = progress.exposure[w.id]; return e && (e.k || e.n >= TARGET_EXPOSURES); }).length;
      out.push({ n: i / LESSON_SIZE + 1, all, shown: all.filter(matches), learned });
    }
    return out;
  });
</script>

<div class="page">
  {#if info}
    <BackButton to="/topics" label="Chủ đề" />
    <h1 class="head" style:--h={hueVar(info.hue)}><span class="disc"><Icon name={info.icon} /></span> {info.title} {#if info.zh}<span class="han zh">{info.zh}</span>{/if}</h1>
    <div class="row actions">
      <a use:glass class="btn glass glass-press primary" href="#/quiz/meaning/{info.deck}"><Icon name="quiz-meaning" /> Đoán nghĩa</a>
      <a use:glass class="btn glass glass-press" href="#/write/{info.deck}"><Icon name="write" hue={HUE_OF.write} /> Viết theo nét</a>
      <a use:glass class="btn glass glass-press" href="#/tones/{info.deck}"><Icon name="tones" hue={HUE_OF.tones} /> Thanh điệu</a>
      <a use:glass class="btn glass glass-press" href="#/build/order/{info.deck}"><Icon name="build" hue={HUE_OF.build} /> Ghép câu</a>
      <span class="spacer"></span>
      <input type="search" class="glass glass-focus" use:glass={{ blur: 0, specular: theme.dark ? 0.2 : LIGHT_SPECULAR, saturate: 1.1 }} placeholder="Lọc trong {list.length} từ…" bind:value={filter} />
    </div>
    {#if kind === 'hsk'}
      {#each lessons.filter((l) => l.shown.length) as l (l.n)}
        <details class="card glass lesson" open={!!filter}>
          <summary class="glass-row"><b>Bài {l.n}</b><span class="muted small">{l.learned}/{l.all.length} từ đã quen</span><span class="progress lp" aria-hidden="true"><i style:width="{(l.learned / l.all.length) * 100}%"></i></span></summary>
          <div class="row lesson-actions">
            <a use:glass class="btn glass glass-press" href="#/quiz/meaning/{info.deck}/{l.n}"><Icon name="quiz-meaning" /> Đoán nghĩa</a>
            <a use:glass class="btn glass glass-press" href="#/write/{info.deck}/{l.n}"><Icon name="write" hue={HUE_OF.write} /> Viết theo nét</a>
          </div>
          {#each l.shown as w (w.id)}<WordRow word={w} />{/each}
        </details>
      {/each}
    {:else}
      <div class="card glass list">
        {#each list as w (w.id)}<WordRow word={w} />{/each}
      </div>
    {/if}
  {:else if kind === 'hsk' && /^[4-6]$/.test(id)}
    <BackButton to="/topics" label="Chủ đề" />
    <p class="empty">HSK {id} đang khoá.<br />Mở khoá ở trang <a href="#/topics">Chủ đề</a>.</p>
    <div class="row unlock">
      <button use:glass class="btn glass glass-press primary" disabled={unlocking} onclick={unlock}>{unlocking ? 'Đang tải…' : `Mở khoá HSK 1–${id}`}</button>
    </div>
    {#if failed}<p class="small bad">Không mở khoá được. Hãy thử lại.</p>{/if}
  {:else}
    <BackButton to="/topics" label="Chủ đề" />
    <p class="empty">Không tìm thấy chủ đề này.</p>
  {/if}
</div>

<style>
  .head { display: flex; align-items: center; flex-wrap: wrap; gap: 0 10px; }
  .head .disc { font-size: 22px; }
  /* On the field, not in a card: the stronger muted ink. */
  .zh { color: var(--text-2-strong); font-size: 20px; }
  .actions { margin: 14px 0 16px; flex-wrap: wrap; }
  .actions a { text-decoration: none; }
  .list { padding: 8px; }
  /* Even padding, and the row's radius is the card's minus it, so the row and its focus ring are concentric. */
  .lesson { padding: 6px; margin-bottom: 10px; }
  .lesson summary { cursor: pointer; display: flex; gap: 12px; align-items: baseline; padding: 10px; border-radius: max(4px, calc(var(--radius) - 6px)); }
  /* The bar carries the row across the column, so the count is not stranded at the left of a wide row. */
  .lp { flex: 1; align-self: center; min-width: 60px; }
  /* Dark: the hovered row lightens toward the track (separation 1.45 at rest, 1.14-1.20 hovered); the track lifts with it. */
  :global(:root[data-theme='dark']) .lesson summary:hover .lp { background: color-mix(in srgb, var(--text) 26%, var(--surface)); }
  /* Fixed label and count widths, so every bar starts at the same x whatever the lesson number. */
  .lesson summary > b { flex: 0 0 4.2em; }
  .lesson summary > .muted { flex: 0 0 9.5em; font-variant-numeric: tabular-nums; }
  /* The filter field shares the pill row: the pills' height, so the row has one top and bottom edge. */
  .actions input { height: 37px; padding-block: 0; }
  .actions input { border-radius: 99px; }
  .lesson-actions { margin: 0 10px 10px; flex-wrap: wrap; }
  .lesson-actions a { text-decoration: none; }
  .unlock { justify-content: center; }
  .small { font-size: 12px; text-align: center; }
</style>
