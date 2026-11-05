<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import BackButton from '../components/BackButton.svelte';
  import { topicById } from '../../lib/data.ts';
  import { progress } from '../../lib/progress.svelte.ts';
  import { TARGET_EXPOSURES } from '../../lib/scheduler.ts';
  import { hskIds, openWord, setHskOpen, settings } from '../../lib/settings.svelte.ts';
  import type { HskLevel, Word } from '../../lib/types.ts';
  import WordRow from '../components/WordRow.svelte';
  import { LESSON_SIZE } from '../deck.ts';

  let { kind, id }: { kind: string; id: string } = $props();

  const info = $derived.by(() => {
    if (kind === 'topic') {
      const t = topicById.get(id);
      return t ? { icon: t.icon, title: t.title, zh: t.titleZh, ids: t.words, deck: `topic/${t.id}` } : null;
    }
    const ids = /^[1-6]$/.test(id) && +id <= settings.hskOpen ? hskIds(+id as HskLevel) : undefined;
    return ids ? { icon: 'course' as const, title: `HSK ${id}`, zh: '', ids, deck: `hsk/${id}` } : null;
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
    <h1><Icon name={info.icon} /> {info.title} {#if info.zh}<span class="han zh">{info.zh}</span>{/if}</h1>
    <div class="row actions">
      <a class="btn primary" href="#/quiz/meaning/{info.deck}"><Icon name="quiz-meaning" /> Đoán nghĩa</a>
      <a class="btn" href="#/write/{info.deck}"><Icon name="write" /> Viết theo nét</a>
      <a class="btn" href="#/tones/{info.deck}"><Icon name="tones" /> Thanh điệu</a>
      <a class="btn" href="#/build/order/{info.deck}"><Icon name="build" /> Ghép câu</a>
      <span class="spacer"></span>
      <input type="search" placeholder="Lọc trong {list.length} từ…" bind:value={filter} />
    </div>
    {#if kind === 'hsk'}
      {#each lessons.filter((l) => l.shown.length) as l (l.n)}
        <details class="card lesson" open={!!filter}>
          <summary><b>Bài {l.n}</b><span class="muted small">{l.learned}/{l.all.length} từ đã quen</span></summary>
          <div class="row lesson-actions">
            <a class="btn" href="#/quiz/meaning/{info.deck}/{l.n}"><Icon name="quiz-meaning" /> Đoán nghĩa</a>
            <a class="btn" href="#/write/{info.deck}/{l.n}"><Icon name="write" /> Viết theo nét</a>
          </div>
          {#each l.shown as w (w.id)}<WordRow word={w} />{/each}
        </details>
      {/each}
    {:else}
      <div class="card list">
        {#each list as w (w.id)}<WordRow word={w} />{/each}
      </div>
    {/if}
  {:else if kind === 'hsk' && /^[4-6]$/.test(id)}
    <BackButton to="/topics" label="Chủ đề" />
    <p class="empty">HSK {id} đang khoá. Mở khoá ở trang <a href="#/topics">Chủ đề</a>.</p>
    <div class="row unlock">
      <button class="btn primary" disabled={unlocking} onclick={unlock}>{unlocking ? 'Đang tải…' : `Mở khoá HSK 1–${id}`}</button>
    </div>
    {#if failed}<p class="small bad">Không mở khoá được. Hãy thử lại.</p>{/if}
  {:else}
    <p class="empty">Không tìm thấy chủ đề này.</p>
  {/if}
</div>

<style>
  .zh { color: var(--text-2); font-size: 20px; margin-left: 6px; }
  .actions { margin: 14px 0 16px; flex-wrap: wrap; }
  .actions a { text-decoration: none; }
  .list { padding: 8px; }
  .lesson { padding: 4px 8px; margin-bottom: 10px; }
  .lesson summary { cursor: pointer; display: flex; gap: 12px; align-items: baseline; padding: 10px 8px; }
  .lesson-actions { margin: 0 8px 8px; flex-wrap: wrap; }
  .lesson-actions a { text-decoration: none; }
  .unlock { justify-content: center; }
  .small { font-size: 12px; text-align: center; }
</style>
