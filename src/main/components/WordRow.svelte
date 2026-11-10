<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import { topicById, topicHue } from '../../lib/data.ts';
  import { progress } from '../../lib/progress.svelte.ts';
  import { TARGET_EXPOSURES } from '../../lib/scheduler.ts';
  import type { Word } from '../../lib/types.ts';
  import Pinyin from '../../lib/ui/Pinyin.svelte';

  /** showTopic: lists that mix topics (search results) mark each word's topic in its group colour. */
  let { word, showTopic = false }: { word: Word; showTopic?: boolean } = $props();
  const topic = $derived(showTopic && word.topics[0] ? topicById.get(word.topics[0]) : undefined);
  const e = $derived(progress.exposure[word.id]);
  const status = $derived(e?.k ? 'known' : (e?.n ?? 0) >= TARGET_EXPOSURES ? 'familiar' : (e?.n ?? 0) > 0 ? 'learning' : 'new');
  const LABEL = { known: 'Đã biết', familiar: 'Đã quen', learning: 'Đang học', new: 'Mới' };
</script>

<a class="row glass-row" href="#/word/{encodeURIComponent(word.id)}" data-has-pinyin>
  <span class="hz han">{word.hanzi}</span>
  <span class="mid">
    <span class="py"><Pinyin text={word.pinyin} syllables={word.syllables} /></span>
    <span class="vi">{word.vi}</span>
  </span>
  <span class="hv">{word.hanviet}</span>
  {#if topic}<span class="tp" title={topic.title}><Icon name={topic.icon} hue={topicHue(topic)} label={topic.title} /></span>{/if}
  {#if e?.s}<span class="star" title="Trong sổ tay"><Icon name="nav-notebook" /></span>{/if}
  <span class="st {status}" title={LABEL[status]}></span>
</a>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 9px 14px;
    /* The list card's radius minus its 8px padding: the inset focus ring stays concentric with the card corner. */
    border-radius: max(4px, calc(var(--radius) - 8px));
    color: var(--text);
    text-decoration: none;
  }
  /* One column width for every headword up to four characters, so the pinyin column lines up. */
  .hz { font-size: 28px; flex: none; width: 118px; }
  /* Reading, topic and star stay next to the meaning at every width; only the status dot goes to the far right. */
  .mid { display: flex; flex-direction: column; flex: 0 1 260px; min-width: 0; }
  .py { font-size: 15px; }
  .vi { font-weight: 800; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* A fixed slot, kept for words without a reading, so the topic icon after it starts at the same x on every row. */
  /* Weight 600: at 400 the small glyphs rendered lighter than the token and only just reached 4.5:1. */
  .hv { color: var(--text-2); font-size: 13px; font-weight: 600; flex: none; min-width: 96px; }
  /* Light: at 13px the strokes render lighter than --text-2 (stroke core 3.6-3.8:1 on the list card). */
  :global(:root[data-theme='light']) .hv { color: color-mix(in srgb, var(--text-2) 60%, var(--text)); }
  .tp { font-size: 17px; display: inline-grid; }
  .star { color: var(--hue-amber); }
  /* New: an empty ring in the muted colour, so it reads at 3:1 like the filled states. */
  .st { width: 10px; height: 10px; border-radius: 50%; box-shadow: inset 0 0 0 2px var(--text-2); flex: none; margin-left: auto; }
  .st.learning { background: var(--tone2); box-shadow: none; }
  .st.familiar { background: var(--tone4); box-shadow: none; }
  .st.known { background: var(--good); box-shadow: none; }
  /* A tabbed row scrolls clear of the window edge. */
  .row { scroll-margin: 16px; }
</style>
