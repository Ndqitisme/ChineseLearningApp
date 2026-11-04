<script lang="ts">
  import { dataset, GROUPS, topics } from '../../lib/data.ts';
  import { progress } from '../../lib/progress.svelte.ts';
  import { TARGET_EXPOSURES } from '../../lib/scheduler.ts';
  import { settings, updateSettings } from '../../lib/settings.svelte.ts';

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
</script>

<div class="page">
  <h1>Chủ đề</h1>
  <p class="lead">Bật 🔔 ở chủ đề nào thì Tiểu Mai sẽ nhắc từ của chủ đề đó. Đang bật {settings.topics.length} chủ đề và {settings.hsk.length} cấp HSK.</p>

  {#each GROUPS as g (g.id)}
    <h2 class="section-title">{g.icon} {g.title}</h2>
    <div class="grid">
      {#each topics.filter((t) => t.group === g.id) as t (t.id)}
        {@const done = learned(t.words)}
        <div class="card topic">
          <a href="#/topic/{t.id}" class="body">
            <span class="icon">{t.icon}</span>
            <b>{t.title}</b>
            <span class="han zh">{t.titleZh}</span>
            <div class="bar"><i style:width="{(done / t.words.length) * 100}%"></i></div>
            <span class="muted small">{done}/{t.words.length} từ đã quen</span>
          </a>
          <button class="bell" class:on={settings.topics.includes(t.id)} onclick={() => toggleTopic(t.id)}
            title={settings.topics.includes(t.id) ? 'Tiểu Mai đang nhắc chủ đề này' : 'Cho Tiểu Mai nhắc chủ đề này'}>🔔</button>
        </div>
      {/each}
    </div>
  {/each}

  <h2 class="section-title">📚 Theo cấp độ HSK 3.0</h2>
  <div class="grid">
    {#each [1, 2, 3] as level (level)}
      {@const ids = dataset.hsk[String(level) as '1' | '2' | '3']}
      {@const done = learned(ids)}
      <div class="card topic">
        <a href="#/hsk/{level}" class="body">
          <span class="icon">🎓</span>
          <b>HSK {level}</b>
          <span class="muted">{ids.length} từ</span>
          <div class="bar"><i style:width="{(done / ids.length) * 100}%"></i></div>
          <span class="muted small">{done}/{ids.length} từ đã quen</span>
        </a>
        <button class="bell" class:on={settings.hsk.includes(level)} onclick={() => toggleHsk(level)} title="Cho Tiểu Mai nhắc">🔔</button>
      </div>
    {/each}
  </div>
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
</style>
