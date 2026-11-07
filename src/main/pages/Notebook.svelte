<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import { progress } from '../../lib/progress.svelte.ts';
  import { openWord } from '../../lib/settings.svelte.ts';
  import { HUE_OF } from '../../lib/theme/themes.ts';
  import type { Word } from '../../lib/types.ts';
  import WordRow from '../components/WordRow.svelte';

  const starred = $derived(
    Object.entries(progress.exposure)
      .filter(([, e]) => e.s)
      .map(([id]) => openWord(id))
      .filter((w): w is Word => !!w),
  );
</script>

<div class="page">
  <h1><Icon name="nav-notebook" hue={HUE_OF.notebook} /> Sổ tay</h1>
  <p class="lead">Các từ đã lưu để luyện riêng.</p>
  {#if starred.length}
    <div class="row actions">
      <a class="btn primary" href="#/quiz/meaning/starred"><Icon name="quiz-meaning" /> Luyện sổ tay</a>
      <a class="btn" href="#/write/starred"><Icon name="write" hue={HUE_OF.write} /> Viết</a>
    </div>
    <div class="card list">{#each starred as w (w.id)}<WordRow word={w} />{/each}</div>
  {:else}
    <p class="empty">Chưa có từ nào. Bấm ☆ trên bong bóng của Tiểu Mai hoặc trong trang từ để lưu vào sổ tay.</p>
  {/if}
</div>

<style>
  .actions { margin-bottom: 14px; }
  .actions a { text-decoration: none; }
  .list { padding: 8px; }
</style>
