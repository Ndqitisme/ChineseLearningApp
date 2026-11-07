<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import { GROUPS, topics } from '../../lib/data.ts';
  import { progress } from '../../lib/progress.svelte.ts';
  import { TARGET_EXPOSURES } from '../../lib/scheduler.ts';
  import { hskIds, setHskOpen, settings, startup, updateSettings } from '../../lib/settings.svelte.ts';
  import type { HskEdition } from '../../lib/types.ts';
  import { LESSON_SIZE } from '../deck.ts';

  const LEVELS = [1, 2, 3, 4, 5, 6] as const;
  const EDITIONS: HskEdition[] = [2021, 2025];
  /** Level whose pack is loading; 0 when idle. */
  let unlocking = $state(0);
  let failed = $state(false);

  function learned(ids: string[]) {
    return ids.filter((id) => { const e = progress.exposure[id]; return e && (e.k || e.n >= TARGET_EXPOSURES); }).length;
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

  {#each GROUPS as g (g.id)}
    <h2 class="section-title"><Icon name={g.icon} /> {g.title}</h2>
    <div class="grid">
      {#each topics.filter((t) => t.group === g.id) as t (t.id)}
        {@const done = learned(t.words)}
        <div class="card topic">
          <a href="#/topic/{t.id}" class="body">
            <span class="icon"><Icon name={t.icon} /></span>
            <b>{t.title}</b>
            <span class="han zh">{t.titleZh}</span>
            <div class="bar"><i style:width="{(done / t.words.length) * 100}%"></i></div>
            <span class="muted small">{done}/{t.words.length} từ đã quen</span>
          </a>
          <button class="bell" class:on={settings.topics.includes(t.id)} onclick={() => toggleTopic(t.id)}
            title={settings.topics.includes(t.id) ? 'Tiểu Mai đang nhắc chủ đề này' : 'Cho Tiểu Mai nhắc chủ đề này'}><Icon name="bell" /></button>
        </div>
      {/each}
    </div>
  {/each}

  <h2 class="section-title"><Icon name="books" /> Khoá học theo cấp HSK 3.0</h2>
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
        {@const done = learned(ids)}
        <div class="card topic">
          <a href="#/hsk/{level}" class="body">
            <span class="icon"><Icon name="course" /></span>
            <b>HSK {level}</b>
            <span class="muted count">{ids.length} từ</span>
            <span class="muted small">{Math.ceil(ids.length / LESSON_SIZE)} bài, mỗi bài {LESSON_SIZE} từ</span>
            <div class="bar"><i style:width="{(done / ids.length) * 100}%"></i></div>
            <span class="muted small">{done}/{ids.length} từ đã quen</span>
          </a>
          <button class="bell" class:on={settings.hsk.includes(level)} onclick={() => toggleHsk(level)}
            title={settings.hsk.includes(level) ? 'Tiểu Mai đang nhắc cấp này' : 'Cho Tiểu Mai nhắc cấp này'}><Icon name="bell" /></button>
        </div>
      {:else}
        <div class="card topic locked">
          <span class="icon"><Icon name="lock" /></span>
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
  .topic { position: relative; padding: 16px 18px; }
  .body { display: flex; flex-direction: column; gap: 3px; color: var(--text); text-decoration: none; }
  .icon { font-size: 30px; }
  .zh { color: var(--text-2); font-size: 16px; }
  .bar { height: 7px; background: var(--surface-2); border-radius: 99px; overflow: hidden; margin-top: 8px; }
  .bar i { display: block; height: 100%; background: var(--primary); border-radius: 99px; }
  .small { font-size: 12px; }
  .bell {
    position: absolute; top: 12px; right: 12px; border: 0; background: var(--surface-2);
    border-radius: 99px; width: 34px; height: 34px; filter: grayscale(1); opacity: .5;
  }
  .bell.on { filter: none; opacity: 1; background: var(--accent); }
  .locked { display: flex; flex-direction: column; gap: 3px; align-items: flex-start; }
  .locked .btn { margin-top: 8px; }
  .unlock-note { margin-top: 12px; }
  .edition { flex-wrap: wrap; gap: 8px; margin: -4px 0 14px; }
</style>
