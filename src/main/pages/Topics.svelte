<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
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
  <p class="lead">Từ vựng theo chủ đề và theo cấp HSK. Bật <Icon name="bell" /> để trợ lý nhắc từ của chủ đề hoặc cấp đó.<br />Đang bật {settings.topics.length} chủ đề và {settings.hsk.length} cấp HSK.</p>

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
        <div class="card topic" class:on style:--h={hueVar(g.hue)}>
          <a href="#/topic/{t.id}" class="body">
            <span class="disc"><Icon name={t.icon} /></span>
            <b>{t.title}</b>
            <span class="han zh">{t.titleZh}</span>
            {@render status(progressOf(t.words))}
          </a>
          <button class="bell" class:on onclick={() => toggleTopic(t.id)}
            title={on ? 'Tiểu Mai đang nhắc chủ đề này' : 'Cho Tiểu Mai nhắc chủ đề này'}><Icon name="bell" /></button>
        </div>
      {/each}
    </div>
  {/each}

  <h2 class="section-title"><Icon name="books" hue={HSK_HUE} /> Khoá học theo cấp HSK 3.0</h2>
  <div class="row edition">
    <span class="muted small">Bộ từ</span>
    {#each EDITIONS as e (e)}
      <button class="chip" class:on={settings.hskEdition === e} onclick={() => updateSettings({ hskEdition: e })}>Bản {e}</button>
    {/each}
    <a class="small" href="#/settings/hsk">Khác nhau thế nào?</a>
  </div>
  <div class="grid">
    {#each LEVELS as level (level)}
      {#if level <= settings.hskOpen}
        {@const ids = hskIds(level) ?? []}
        {@const on = settings.hsk.includes(level)}
        <div class="card topic" class:on style:--h={hueVar(HSK_HUE)}>
          <a href="#/hsk/{level}" class="body">
            <span class="disc"><Icon name="course" /></span>
            <b>HSK {level}</b>
            <span class="muted count">{ids.length} từ</span>
            <span class="muted small">{Math.ceil(ids.length / LESSON_SIZE)} bài, mỗi bài {LESSON_SIZE} từ</span>
            {@render status(progressOf(ids))}
          </a>
          <button class="bell" class:on onclick={() => toggleHsk(level)}
            title={on ? 'Tiểu Mai đang nhắc cấp này' : 'Cho Tiểu Mai nhắc cấp này'}><Icon name="bell" /></button>
        </div>
      {:else}
        <div class="card topic locked">
          <span class="disc"><Icon name="lock" /></span>
          <b>HSK {level}</b>
          <span class="muted small">{alsoOpens(level)}</span>
          <button class="btn" disabled={!!unlocking} onclick={() => unlock(level)}>{unlocking === level ? 'Đang tải…' : 'Mở khoá'}</button>
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
  .topic.on { border-color: color-mix(in srgb, var(--h) 55%, var(--surface)); background: color-mix(in srgb, var(--h) 7%, var(--surface)); }
  /* --text-2 alone drops under 4.5:1 on the tint (sakura light). */
  .topic.on .muted, .topic.on .zh { color: color-mix(in srgb, var(--text-2) 85%, var(--text)); }
  .body { flex: 1; display: flex; flex-direction: column; align-items: flex-start; gap: 3px; color: var(--text); text-decoration: none; }
  .disc { font-size: 26px; margin-bottom: 4px; }
  .locked .disc { --h: var(--text-2); }
  .zh { color: var(--text-2); font-size: 16px; }
  .status { align-self: stretch; margin-top: auto; padding-top: 8px; }
  .full { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 800; }
  .full :global(.icon) { color: var(--good); }
  .bar { height: 7px; background: color-mix(in srgb, var(--h) 14%, var(--surface-2)); border-radius: 99px; overflow: hidden; margin-bottom: 3px; }
  .bar i { display: block; height: 100%; background: var(--h); border-radius: 99px; }
  .small { font-size: 12px; }
  .bell {
    position: absolute; top: 12px; right: 12px; border: 0; background: var(--surface-2); color: var(--text-2);
    border-radius: 99px; width: 34px; height: 34px;
  }
  /* Filled: a solid circle in the group colour; --surface on it is the same 3:1+ pair as the hue on --surface. */
  .bell.on { background: var(--h); color: var(--surface); }
  .locked { display: flex; flex-direction: column; gap: 3px; align-items: flex-start; }
  .locked .btn { margin-top: 8px; }
  .unlock-note { margin-top: 12px; }
  .edition { flex-wrap: wrap; gap: 8px; margin: -4px 0 14px; }
</style>
