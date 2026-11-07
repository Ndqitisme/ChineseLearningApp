<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import BackButton from '../components/BackButton.svelte';
  import { onMount, tick } from 'svelte';
  import { HSK_HUE, levelOf, loadLevels, topicById, topicHue, wordById } from '../../lib/data.ts';
  import { requestExposurePatch } from '../../lib/exposure.ts';
  import { isHan } from '../../lib/pinyin.ts';
  import { progress, saveProgress } from '../../lib/progress.svelte.ts';
  import { speak, speechAvailable } from '../../lib/speech/index.ts';
  import { hskLevel, isOpenAnyEdition, settings } from '../../lib/settings.svelte.ts';
  import { previewIntervals } from '../../lib/srs.ts';
  import { HUE_OF, hueVar } from '../../lib/theme/themes.ts';
  import Pinyin from '../../lib/ui/Pinyin.svelte';
  import HanziStroke from '../components/HanziStroke.svelte';

  let { id }: { id: string } = $props();
  // A link may name a word of a locked level whose pack is not loaded: load the packs to say which level it is in.
  let packsLoaded = $state(settings.hskOpen === 6);
  const known = $derived((void packsLoaded, wordById.get(id)));
  // Open in either edition: a word found in search, the notebook or review keeps its page after an edition switch.
  const word = $derived(known && isOpenAnyEdition(known) ? known : undefined);
  const level = $derived(word && hskLevel(word));
  const otherEdition = $derived(settings.hskEdition === 2025 ? 2021 : 2025);
  /** For a locked word: its level in the chosen edition, else in the other one. */
  const lockedLevel = $derived(known && (hskLevel(known) ?? levelOf(known, otherEdition)));
  const otherLevel = $derived(word && levelOf(word, otherEdition));
  const e = $derived(word ? progress.exposure[word.id] : undefined);
  const card = $derived(word ? progress.srs[word.id] : undefined);
  let speakError = $state('');
  let strokeKey = $state(0);
  let strokeEls = $state<HanziStroke[]>([]);
  let strokeRun = 0;

  /** One character at a time, left to right: animating all of them at once is hard to follow. */
  async function playStrokes() {
    const run = ++strokeRun;
    await tick();
    for (const el of strokeEls) {
      if (run !== strokeRun) return;
      await el?.play();
    }
  }
  function replayStrokes() {
    strokeKey++;
    playStrokes();
  }
  onMount(() => {
    playStrokes();
    if (!wordById.get(id)) loadLevels(6).catch(() => {}).finally(() => (packsLoaded = true));
  });

  async function say(slot: 'female' | 'male', text: string) {
    speakError = '';
    try { await speak(text, slot); } catch (err) { speakError = String((err as Error).message ?? err); }
  }
  async function addToReview() {
    if (!word || progress.srs[word.id]) return;
    progress.srs[word.id] = { due: new Date().toISOString(), stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0 };
    await saveProgress('srs');
  }
</script>

<div class="page">
  {#if word}
    <BackButton to="/search" useHistory />
    <div class="hero card">
      <div class="strokes">
        {#key strokeKey}
          {#each [...word.hanzi].filter(isHan) as ch, i (i)}
            <HanziStroke bind:this={strokeEls[i]} char={ch} size={[...word.hanzi].length > 2 ? 120 : 170} mode="sequence" />
          {/each}
        {/key}
      </div>
      <div class="info" data-has-pinyin>
        <div class="py"><Pinyin text={word.pinyin} syllables={word.syllables} /></div>
        <div class="vi">{word.vi}</div>
        {#if word.hanviet}<div class="hv">Hán Việt: <b>{word.hanviet}</b></div>{/if}
        <div class="chips">
          {#if level}<a class="chip hued" href="#/hsk/{level}" style:--h={hueVar(HSK_HUE)}>HSK {level}</a>{/if}
          {#if (level || otherLevel) && otherLevel !== level}
            <span class="chip other" title="Cấp của từ này trong bộ từ bản {otherEdition}">Bản {otherEdition}: {otherLevel ? `HSK ${otherLevel}` : 'không có'}</span>
          {/if}
          {#each word.topics as t (t)}
            {@const topic = topicById.get(t)}
            {#if topic}<a class="chip hued" href="#/topic/{t}" style:--h={hueVar(topicHue(topic))}><Icon name={topic.icon} /> {topic.title}</a>{/if}
          {/each}
        </div>
        <div class="row btns">
          <button class="btn" onclick={replayStrokes}><Icon name="write" hue={HUE_OF.write} /> Xem lại nét</button>
          {#if speechAvailable()}
            <button class="btn" onclick={() => say('female', word.hanzi)}><Icon name="speaker" hue={HUE_OF.listen} /> Giọng nữ</button>
            <button class="btn" onclick={() => say('male', word.hanzi)}><Icon name="speaker" hue={HUE_OF.listen} /> Giọng nam</button>
          {:else}
            <a class="btn ghost" href="#/settings/voice"><Icon name="speaker-off" /> Cài giọng đọc…</a>
          {/if}
        </div>
        {#if speakError}<p class="bad small">{speakError}</p>{/if}
      </div>
    </div>

    {#if word.ex}
      <h2 class="section-title">Ví dụ</h2>
      <div class="card ex">
        <div class="han ex-zh" data-hover-pinyin="on">{word.ex.zh}
          {#if speechAvailable()}<button class="btn ghost sm" onclick={() => say('female', word.ex!.zh)}><Icon name="speaker" hue={HUE_OF.listen} /></button>{/if}
        </div>
        <div class="ex-py" data-has-pinyin>{word.ex.py}</div>
        <div class="ex-vi">{word.ex.vi}</div>
      </div>
    {/if}

    {#if word.viFull && word.viFull !== word.vi}
      <h2 class="section-title">Nghĩa đầy đủ (CVDICT)</h2>
      <div class="card full">{word.viFull}</div>
    {/if}

    <h2 class="section-title">Học từ này</h2>
    <div class="row btns">
      <button class="btn" class:primary={e?.s} onclick={() => requestExposurePatch(word.id, { starred: !e?.s })}>{e?.s ? '★ Đã lưu sổ tay' : '☆ Lưu vào sổ tay'}</button>
      <button class="btn" class:primary={e?.k} onclick={() => requestExposurePatch(word.id, { known: !e?.k })}>{e?.k ? '✓ Đã biết' : 'Đánh dấu đã biết'}</button>
      {#if card}
        <span class="muted">Ôn tiếp: {new Date(card.due).toLocaleDateString('vi-VN')} · lần ôn {card.reps}</span>
      {:else}
        <button class="btn" onclick={addToReview}><Icon name="nav-review" hue={HUE_OF.review} /> Thêm vào ôn tập</button>
        <span class="muted small">Nếu nhớ tốt, lần ôn sau: {previewIntervals(undefined)[3]}</span>
      {/if}
    </div>
    <p class="muted small">Đã gặp từ này {e?.n ?? 0} lần.</p>
  {:else if known}
    <BackButton to="/search" useHistory />
    <p class="empty">Từ “{known.hanzi}” thuộc HSK {lockedLevel}, cấp này đang khoá.<br />Mở khoá ở trang <a href="#/hsk/{lockedLevel}">HSK {lockedLevel}</a>.</p>
  {:else if packsLoaded}
    <BackButton to="/search" useHistory />
    <p class="empty">Không tìm thấy từ “{id}”.</p>
  {:else}
    <p class="empty">Đang tải…</p>
  {/if}
</div>

<style>
  .hero { display: flex; gap: 28px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
  .strokes { display: flex; gap: 10px; flex-wrap: wrap; }
  .info { flex: 1; min-width: 240px; display: flex; flex-direction: column; gap: 6px; }
  .py { font-size: 30px; }
  .vi { font-size: 24px; font-weight: 900; }
  .hv { color: var(--text-2); font-size: 16px; }
  .hv b { color: var(--text); }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chips a { text-decoration: none; }
  .btns { flex-wrap: wrap; margin-top: 6px; }
  .btns a { text-decoration: none; }
  .ex-zh { font-size: 26px; display: flex; align-items: center; gap: 6px; }
  .ex-py { font-family: var(--font-pinyin); color: var(--text-2); font-size: 17px; margin-top: 2px; }
  .ex-vi { font-weight: 800; margin-top: 6px; font-size: 16px; }
  .full { line-height: 1.6; }
  .small { font-size: 12.5px; }
  .sm { padding: 2px 8px; }
</style>
