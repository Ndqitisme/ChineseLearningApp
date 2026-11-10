<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import { glass } from '../../lib/ui/glass/glass.ts';
  import { progress } from '../../lib/progress.svelte.ts';
  import { openWordAnyEdition } from '../../lib/settings.svelte.ts';
  import { HUE_OF } from '../../lib/theme/themes.ts';
  import type { Word } from '../../lib/types.ts';
  import WordRow from '../components/WordRow.svelte';

  const starred = $derived(
    Object.entries(progress.exposure)
      .filter(([, e]) => e.s)
      .map(([id]) => openWordAnyEdition(id))
      .filter((w): w is Word => !!w),
  );
</script>

<div class="page">
  <h1><Icon name="nav-notebook" hue={HUE_OF.notebook} /> Sổ tay</h1>
  <p class="lead">Các từ đã lưu để luyện riêng.</p>
  {#if starred.length}
    <div class="row actions">
      <a use:glass class="btn glass glass-press primary" href="#/quiz/meaning/starred"><Icon name="quiz-meaning" /> Luyện sổ tay</a>
      <a use:glass class="btn glass glass-press" href="#/write/starred"><Icon name="write" hue={HUE_OF.write} /> Viết</a>
    </div>
    <div class="card glass list">{#each starred as w (w.id)}<WordRow word={w} />{/each}</div>
  {:else}
    <p class="empty">Chưa có từ nào.<br />Bấm <Icon name="nav-notebook" /> trên bảng gợi ý hoặc trong trang từ để lưu vào sổ tay.</p>
  {/if}
</div>

<style>
  .actions { margin-bottom: 14px; }
  .actions a { text-decoration: none; }
  .list { padding: 8px; }
</style>
