<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import { revealRow } from '../../lib/ui/reveal.ts';
  import { glass } from '../../lib/ui/glass/glass.ts';
  import { HUE_OF } from '../../lib/theme/themes.ts';
  import BackButton from '../components/BackButton.svelte';
  import { PitchDetector } from 'pitchy';
  import { parseMarked, type Tone } from '../../lib/pinyin.ts';
  import { speak, speechAvailable } from '../../lib/speech/index.ts';
  import { acceptedTones, scoreTones, template, TONE_NAME, type ToneResult } from '../../lib/tones.ts';
  import type { Word } from '../../lib/types.ts';
  import Pinyin from '../../lib/ui/Pinyin.svelte';
  import { deckFrom, deckOrigin, shuffle } from '../deck.ts';

  import { untrack } from 'svelte';
  let { params }: { params: string[] } = $props();
  const deck = untrack(() => deckFrom(params));
  // Tone drills work best on short words.
  const queue: Word[] = shuffle(deck.words.filter((w) => w.syllables.length <= 3 && w.syllables.every((s) => s.py))).slice(0, 10);

  let index = $state(0);
  let picks = $state<(Tone | null)[]>([]);
  let checked = $state(false);
  let recording = $state(false);
  let result = $state<ToneResult | null>(null);
  let micError = $state<string[]>([]);
  let score = $state(0);
  let nextRow = $state<HTMLElement>();
  // The row is in view before the check: when the pill appears the page does not move under the pointer.
  $effect(() => { if (word) revealRow(nextRow); });

  const word = $derived(queue[index]);
  const tones = $derived(word ? word.syllables.map((s) => s.tone) : []);
  const bases = $derived(word ? word.syllables.map((s) => parseMarked(s.py).base) : []);
  /** Tone sandhi (不对 búduì, 一起 yìqǐ, 你好 níhǎo): the spoken tone counts as right too. */
  const accepted = $derived(word ? acceptedTones(word.hanzi, word.syllables) : []);
  const allRight = $derived(picks.every((p, i) => p !== null && accepted[i]?.includes(p)));
  $effect(() => { picks = tones.map(() => null); });

  // The drill keeps only its own score: picking tones says nothing about recalling the whole word, so it writes
  // no review schedule.
  function check() {
    if (!word) return;
    checked = true;
    if (allRight) score++;
  }
  function next() {
    if (recording) return;
    index++;
    checked = false;
    result = null;
  }

  /** getUserMedia failures, by the cause the learner can act on: the state, then what to do. */
  function micMessage(e: unknown): string[] {
    const name = e instanceof DOMException ? e.name : '';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return ['Không tìm thấy micro.', 'Cắm micro rồi thử lại.'];
    if (name === 'NotReadableError' || name === 'AbortError') return ['Micro đang được ứng dụng khác dùng.', 'Tắt ứng dụng đó rồi thử lại.'];
    return ['Tiểu Mai chưa được phép dùng micro.', 'Cho phép trong cài đặt quyền riêng tư của hệ điều hành.'];
  }

  async function record(seconds = 2.2) {
    // Set before any await: a double click must not open two microphone streams.
    if (recording || !word) return;
    recording = true;
    micError = [];
    result = null;
    // Scored against the word the recording was made for, whatever the page shows by the time it ends.
    const forIndex = index, forTones = tones;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      micError = micMessage(e);
      recording = false;
      return;
    }
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const detector = PitchDetector.forFloat32Array(analyser.fftSize);
    const buffer = new Float32Array(analyser.fftSize);
    const samples: (number | null)[] = [];
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buffer);
      const [pitch, clarity] = detector.findPitch(buffer, ctx.sampleRate);
      samples.push(clarity > 0.88 && pitch > 70 && pitch < 600 ? pitch : null);
    }, 10);
    await new Promise((r) => setTimeout(r, seconds * 1000));
    clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close();
    recording = false;
    if (index === forIndex) result = scoreTones(samples, forTones);
  }

  /** The plot is drawn at its frame's own pixel width, 10px in from the sides. The pitch range stops 20px short of the
   *  top and bottom, so a level tone is not read as the frame's edge. */
  let plotW = $state(600);
  const PLOT_H = 170, INSET = 10, HEADROOM = 20, GAP = 6;
  const plotX = (f: number) => INSET + f * (plotW - 2 * INSET);
  const plotY = (v: number) => HEADROOM + (1 - v) * (PLOT_H - 2 * HEADROOM);
  const points = (values: number[], x0: number, x1: number) => values.map((v, i) => [x0 + (i / (values.length - 1)) * (x1 - x0), plotY(v)]);
  const line = (pts: number[][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
  const path = (values: number[]) => (values.length ? line(points(values, plotX(0), plotX(1))) : '');
  /** The dashes of .tpl: 8 on, 6 off. */
  const DASH = 8, PERIOD = 14;
  /** Syllable k of n: its own segment of the reference, kept GAP px clear of the dividers on each side. Its pathLength
   *  stretches the dashes a little so the segment ends on a whole dash, not a loose speck. */
  function sylPath(t: Tone, k: number, n: number) {
    const pts = points(template([t]), plotX(k / n) + (k ? GAP : 0), plotX((k + 1) / n) - (k < n - 1 ? GAP : 0));
    const len = pts.slice(1).reduce((sum, [x, y], i) => sum + Math.hypot(x - pts[i][0], y - pts[i][1]), 0);
    return { d: line(pts), pathLength: Math.max(1, Math.round((len + PERIOD - DASH) / PERIOD)) * PERIOD - (PERIOD - DASH) };
  }
</script>

<div class="page">
  <BackButton to={deckOrigin(params)} useHistory />
  <h1><Icon name="tones" hue={HUE_OF.tones} /> Thanh điệu</h1>
  <p class="lead">{deck.title}<br />Chọn thanh cho từng âm tiết, sau đó đọc to để so đường cao&nbsp;độ.</p>

  {#if deck.gone}
    <p class="empty">{deck.gone.text} <a href={deck.gone.href}>{deck.gone.link}</a></p>
  {:else if word}
    <div class="card glass drill">
      <span class="muted">Từ {index + 1}/{queue.length} · đúng {score}</span>
      <div class="hz han" data-hover-pinyin="off">{word.hanzi}</div>
      <div class="vi">{word.vi}</div>
      {#if speechAvailable()}<button use:glass class="btn glass glass-press" onclick={() => speak(word.hanzi).catch(() => {})}><Icon name="speaker" /> Nghe mẫu</button>{/if}

      <div class="sylls" data-hover-pinyin="off">
        {#each bases as base, i (i)}
          <div class="syl">
            <b class="base">{checked ? word.syllables[i].py : base}</b>
            <div class="tones">
              {#each [1, 2, 3, 4, 5] as t (t)}
                <button
                  class="tone glass glass-press t{t}"
                  use:glass={{ hover: true }}
                  class:on={picks[i] === t}
                  class:right={checked && (tones[i] === t || (picks[i] === t && accepted[i].includes(t)))}
                  class:wrong={checked && picks[i] === t && !accepted[i].includes(t)}
                  disabled={checked}
                  title={TONE_NAME[t as Tone]}
                  onclick={() => (picks[i] = t as Tone)}
                >{['ā', 'á', 'ǎ', 'à', 'a'][t - 1]}{#if checked && (tones[i] === t || (picks[i] === t && accepted[i].includes(t)))}<span class="badge verdict-mark right"><Icon name="check-disc" size="17px" /></span>{:else if checked && picks[i] === t}<span class="badge verdict-mark wrong"><Icon name="cross-disc" size="17px" /></span>{/if}</button>
              {/each}
            </div>
          </div>
        {/each}
      </div>

      <div class="verdict">
        {#if !checked}
          <button use:glass class="btn glass glass-press primary" disabled={picks.some((p) => p === null)} onclick={check}>Kiểm tra</button>
        {:else}
          <div class="answer" data-has-pinyin>
            <span class="verdict-label">{#if allRight}<span class="good"><Icon name="done" /></span>{:else}<span class="bad"><Icon name="cross" /></span>{/if}{allRight ? 'Đúng' : 'Chưa đúng'}</span>
            {#if !allRight}<span class="label muted">Đáp án</span>{/if}
            <Pinyin text={word.pinyin} syllables={word.syllables} />
          </div>
        {/if}
      </div>
    </div>
    <!-- Right-aligned under the exercise, as on the other practice pages. -->
    <!-- The row is there before the check too, so nothing below moves when the pill appears. -->
    <div class="row next" bind:this={nextRow}>{#if checked}<button use:glass class="btn glass glass-press primary" disabled={recording} onclick={next} {@attach revealRow}>Tiếp →</button>{/if}</div>

    <h2 class="section-title">Đọc to và so cao độ <span class="muted">(tham khảo)</span></h2>
    <div class="card glass speak">
      <div class="row">
        <button use:glass class="btn glass glass-press primary" disabled={recording} onclick={() => record()}><Icon name="mic" /> {recording ? 'Đang nghe…' : 'Ghi âm 2 giây'}</button>
        {#if result}<b class="big-score">{result.score}/100</b>{/if}
      </div>
      {#if micError.length}<p class="bad">{micError[0]}<br />{micError[1]}</p>{/if}
      <div class="plot" bind:clientWidth={plotW}>
        <svg viewBox="0 0 {plotW} {PLOT_H}" aria-label="Đường cao độ">
          <!-- Dividers only between syllables. -->
          {#each tones.slice(1) as _, i (i)}
            <line x1={plotX((i + 1) / tones.length)} x2={plotX((i + 1) / tones.length)} y1="0" y2={PLOT_H} class="sep" />
          {/each}
          <!-- The reference contour gives the answer away: it appears with the verdict. -->
          {#if checked}{#each tones as t, k (k)}{@const seg = sylPath(t, k, tones.length)}<path d={seg.d} pathLength={seg.pathLength} class="tpl" />{/each}{/if}
          {#if result}<path d={path(result.contour)} class="me" />{/if}
        </svg>
      </div>
      <p class="muted small">Nét liền là giọng của bạn.<br />Nét đứt là đường thanh chuẩn, hiện sau khi kiểm tra.<br />Điểm chỉ mang tính tham khảo: thời gian được chia đều cho các âm tiết và app không nhận dạng chữ.</p>
    </div>
  {:else if queue.length}
    <div class="card glass done"><div class="big"><Icon name="result-tones" /></div><h2>Đúng {score}/{queue.length} từ</h2><a use:glass class="btn glass glass-press primary" href="#/practice">Về trang luyện tập</a></div>
  {:else}
    <p class="empty">Chưa có từ để luyện.</p>
  {/if}
</div>

<style>
  .drill { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; }
  .hz { font-size: 64px; line-height: 1.1; }
  .vi { font-weight: 900; font-size: 19px; }
  .sylls { display: flex; gap: 22px; flex-wrap: wrap; justify-content: center; margin: 8px 0; }
  .syl { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .base { font-family: var(--font-pinyin); font-size: 26px; }
  .tones { display: flex; gap: 5px; }
  /* The tone mark on a vowel, in the pinyin face (Nunito lacks ǎ): a 20px glyph centred in the button. */
  .tone { width: 40px; height: 40px; border-radius: 12px; border: 0; padding: 0; font-family: var(--font-pinyin); font-size: 21px; line-height: 1; font-weight: 700; --glass-alpha: 30%; }
  /* The check pill and the verdict line share one slot, so the card keeps its height. */
  .verdict { min-height: 38px; display: flex; align-items: center; justify-content: center; }
  /* Picked, right, wrong: a 2px ring over the edge with the glass rim just inside it, the contact shadow kept. */
  .tone { --arc-inset: 2px; --arc-r: 12px; }
  /* Inside the button: the buttons sit 3–5px apart, so a ring 2px out ran into the next one. */
  .tone:focus-visible { outline-offset: -3px; }
  .tone.right, .tone.wrong { --glass-rim-w: 3px; box-shadow: inset 0 0 0 2px var(--c), var(--glass-rim), var(--glass-shadow, var(--shadow)); }
  /* Picked: a primary tint and a bar under the button, no ring, so a picked button is never taken for keyboard focus. */
  .tone:hover:not(:disabled):not(.on):not(:active) { --glass-tint: color-mix(in srgb, var(--primary) var(--pill-hover-tint), var(--surface)); }
  /* Opaque, the 22 % tint took the tone colours to 4.38-4.44:1 (contrast.mjs, light themes); 12 % keeps them at 4.5:1. */
  @media (prefers-reduced-transparency: reduce) {
    :global(:root[data-theme='light']) .tone:hover:not(:disabled):not(.on):not(:active) { --glass-tint: color-mix(in srgb, var(--primary) 12%, var(--surface)); }
  }
  .tone.on { --glass-tint: color-mix(in srgb, var(--primary) 20%, var(--surface)); --glass-alpha: 92%; }
  .tone.on::after { content: ''; position: absolute; left: 8px; right: 8px; bottom: -7px; height: 3px; border-radius: 2px; background: var(--primary-ink); pointer-events: none; }
  /* 12 % of the state colour: at 18–22 % the tone colours on it fell under 4.5:1 (tone 1 on the wrong tint in Trà sữa). */
  .tone.right { --c: var(--good); --glass-tint: color-mix(in srgb, var(--good) 12%, var(--surface)); --glass-alpha: 88%; }
  .tone.wrong { --c: var(--bad); --glass-tint: color-mix(in srgb, var(--bad) 12%, var(--surface)); --glass-alpha: 88%; }
  /* Up to three syllables on one row in the narrow window, so "Kiểm tra" stays in view. */
  @media (max-width: 960px) {
    .sylls { gap: 12px; }
    .tones { gap: 3px; }
    .tone { width: 32px; height: 32px; font-size: 18px; border-radius: 10px; }
  }
  /* Checked: the unchosen buttons lose their glass (no face, rim or shadow), so they read as locked; the tone colours stay. */
  .tone:disabled:not(.right):not(.wrong) { --glass-alpha: 0%; --glass-rim-hi: 0; --glass-rim-mid: 0; --glass-rim-dark: 0%; --glass-rim-side: 0%; --glass-shadow: 0 0 transparent; backdrop-filter: none; }
  .tone:disabled.t1 { color: var(--tone1); } .tone:disabled.t2 { color: var(--tone2); } .tone:disabled.t3 { color: var(--tone3); }
  .tone:disabled.t4 { color: var(--tone4); } .tone:disabled.t5 { color: var(--tone5); }
  .t1 { color: var(--tone1); } .t2 { color: var(--tone2); } .t3 { color: var(--tone3); } .t4 { color: var(--tone4); } .t5 { color: var(--tone5); }
  .answer { font-size: 20px; font-weight: 800; display: flex; gap: 10px; align-items: baseline; }
  .answer .label { font-size: 14px; font-weight: 600; }
  /* The verdict is a mark and a label in the text colour: the tone colours on the pinyin beside it share its hues. */
  .verdict-label { display: inline-flex; align-items: center; gap: 6px; color: var(--text); }
  /* A right or wrong ring also carries a check or a cross, so it does not rest on colour alone (a green ring round the
     green tone 3, a red one round the red tone 1). The 14px disc is centred on the ring where its corner arc meets the
     top edge (8px in from the right, 1px down), and a 2px surface-coloured ring keeps it off the state ring (on a ring of
     the tinted face the red disc fell to 2.9:1). Disc and gap end 1px past the side: at 860 the buttons sit 3px apart,
     and a disc centred 4px in from both edges met the next button's ring. */
  .badge { position: absolute; top: -6px; right: 1px; width: 14px; height: 14px; box-shadow: 0 0 0 2px var(--surface); }
  .badge :global(.icon) { margin: -1.5px; }
  .speak { display: flex; flex-direction: column; gap: 10px; }
  .big-score { font-size: 24px; color: var(--primary-ink); }
  /* An inset well with one text-coloured edge on all four sides, so it keeps its rounded outline in light and dark;
     the clip keeps the separators inside the corners. */
  .plot svg { display: block; width: 100%; height: 100%; }
  .plot { width: 100%; height: 170px; background: color-mix(in srgb, var(--primary) 6%, transparent);
    --plot-r: max(4px, calc(var(--radius) - 20px)); border-radius: var(--plot-r); clip-path: inset(0 round var(--plot-r));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 22%, transparent), inset 0 2px 4px rgb(var(--glass-black) / .1); }
  .sep { stroke: var(--border); stroke-width: 1.5; }
  .tpl { fill: none; stroke: var(--text-2); stroke-width: 3; stroke-dasharray: 8 6; }
  .me { fill: none; stroke: var(--primary); stroke-width: 3.5; stroke-linejoin: round; }
  .small { font-size: 12.5px; margin: 0; }
  .next { justify-content: flex-end; margin-top: 14px; min-height: 38px; }
  .done { text-align: center; padding: 30px; }
  .done .big { font-size: 48px; }
  .done a { text-decoration: none; }
</style>
