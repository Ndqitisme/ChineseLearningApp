<script lang="ts">
  import { wordById } from '../../lib/data.ts';
  import { progress } from '../../lib/progress.svelte.ts';
  import type { Word } from '../../lib/types.ts';
  import WordRow from '../components/WordRow.svelte';

  const starred = $derived(
    Object.entries(progress.exposure)
      .filter(([, e]) => e.s)
      .map(([id]) => wordById.get(id))
      .filter((w): w is Word => !!w),
  );
</script>

<div class="page">
  <h1>⭐ Sổ tay</h1>
  <p class="lead">Những từ bạn bấm ☆ trên bong bóng của Tiểu Mai hoặc trong trang từ.</p>
  {#if starred.length}
    <div class="row actions">
      <a class="btn primary" href="#/quiz/meaning/starred">🧠 Luyện sổ tay</a>
      <a class="btn" href="#/write/starred">✍️ Viết</a>
    </div>
    <div class="card list">{#each starred as w (w.id)}<WordRow word={w} />{/each}</div>
  {:else}
    <p class="empty">Sổ tay còn trống. Khi Tiểu Mai đưa ra một từ hay, bấm ☆ để lưu lại nhé.</p>
  {/if}
</div>

<style>
  .actions { margin-bottom: 14px; }
  .actions a { text-decoration: none; }
  .list { padding: 8px; }
</style>
