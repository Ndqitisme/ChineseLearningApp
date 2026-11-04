<script lang="ts">
  import BackButton from '../components/BackButton.svelte';
  import { dataset, topicById, wordById } from '../../lib/data.ts';
  import type { Word } from '../../lib/types.ts';
  import WordRow from '../components/WordRow.svelte';

  let { kind, id }: { kind: string; id: string } = $props();

  const info = $derived.by(() => {
    if (kind === 'topic') {
      const t = topicById.get(id);
      return t ? { title: `${t.icon} ${t.title}`, zh: t.titleZh, ids: t.words, deck: `topic/${t.id}` } : null;
    }
    const ids = dataset.hsk[id as '1' | '2' | '3'];
    return ids ? { title: `🎓 HSK ${id}`, zh: '', ids, deck: `hsk/${id}` } : null;
  });
  let filter = $state('');
  const list = $derived(
    (info?.ids ?? []).map((i) => wordById.get(i)).filter((w): w is Word => !!w)
      .filter((w) => !filter || w.hanzi.includes(filter) || w.vi.toLowerCase().includes(filter.toLowerCase())),
  );
</script>

<div class="page">
  {#if info}
    <BackButton to="/topics" label="Chủ đề" />
    <h1>{info.title} {#if info.zh}<span class="han zh">{info.zh}</span>{/if}</h1>
    <div class="row actions">
      <a class="btn primary" href="#/quiz/meaning/{info.deck}">🧠 Đoán nghĩa</a>
      <a class="btn" href="#/write/{info.deck}">✍️ Viết theo nét</a>
      <a class="btn" href="#/tones/{info.deck}">🎵 Thanh điệu</a>
      <a class="btn" href="#/build/order/{info.deck}">🧩 Ghép câu</a>
      <span class="spacer"></span>
      <input type="search" placeholder="Lọc trong {list.length} từ…" bind:value={filter} />
    </div>
    <div class="card list">
      {#each list as w (w.id)}<WordRow word={w} />{/each}
    </div>
  {:else}
    <p class="empty">Không tìm thấy chủ đề này.</p>
  {/if}
</div>

<style>
  .zh { color: var(--text-2); font-size: 20px; margin-left: 6px; }
  .actions { margin: 14px 0 16px; flex-wrap: wrap; }
  .actions a { text-decoration: none; }
  .list { padding: 8px; }
</style>
