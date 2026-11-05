<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import BackButton from '../components/BackButton.svelte';
  import { PitchDetector } from 'pitchy';
  import { parseMarked, type Tone } from '../../lib/pinyin.ts';
  import { progress, saveProgress, today } from '../../lib/progress.svelte.ts';
  import { speak, speechAvailable } from '../../lib/speech/index.ts';
  import { review, Rating } from '../../lib/srs.ts';
  import { scoreTones, template, TONE_NAME, type ToneResult } from '../../lib/tones.ts';
  import type { Word } from '../../lib/types.ts';
  import Pinyin from '../../lib/ui/Pinyin.svelte';
  import { deckFrom, shuffle } from '../deck.ts';

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
  let micError = $state('');
  let score = $state(0);

  const word = $derived(queue[index]);
  const tones = $derived(word ? word.syllables.map((s) => s.tone) : []);
  const bases = $derived(word ? word.syllables.map((s) => parseMarked(s.py).base) : []);
  $effect(() => { picks = tones.map(() => null); });

  async function check() {
    if (!word) return;
    checked = true;
    const ok = picks.every((p, i) => p === tones[i]);
    if (ok) score++;
    progress.srs[word.id] = review(progress.srs[word.id], ok ? Rating.Good : Rating.Again);
    progress.reviewDays[today()] = (progress.reviewDays[today()] ?? 0) + 1;
    await Promise.all([saveProgress('srs'), saveProgress('reviewDays')]);
  }
  function next() {
    index++;
    checked = false;
    result = null;
  }

  async function record(seconds = 2.2) {
    micError = '';
    result = null;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      micError = 'Không mở được micro. Hãy cho phép Tiểu Mai dùng micro trong cài đặt quyền riêng tư của hệ điều hành.';
      return;
    }
    recording = true;
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
    result = scoreTones(samples, tones);
  }

  function path(values: number[], w: number, h: number) {
    if (!values.length) return '';
    return values.map((v, i) => `${i ? 'L' : 'M'}${(i / (values.length - 1)) * w},${h - v * h}`).join(' ');
  }
</script>

<div class="page">
  <BackButton to="/practice" label="Luyện tập" />
  <h1><Icon name="tones" /> Thanh điệu</h1>
  <p class="lead">{deck.title}<br />Chọn thanh cho từng âm tiết, sau đó đọc to để so đường cao độ.</p>

  {#if deck.gone}
    <p class="empty">{deck.gone.text} <a href={deck.gone.href}>{deck.gone.link}</a></p>
  {:else if word}
    <div class="card drill">
      <span class="muted">Từ {index + 1}/{queue.length} · đúng {score}</span>
      <div class="hz han" data-hover-pinyin="off">{word.hanzi}</div>
      <div class="vi">{word.vi}</div>
      {#if speechAvailable()}<button class="btn" onclick={() => speak(word.hanzi).catch(() => {})}><Icon name="speaker" /> Nghe mẫu</button>{/if}

      <div class="sylls" data-hover-pinyin="off">
        {#each bases as base, i (i)}
          <div class="syl">
            <b class="base">{checked ? word.syllables[i].py : base}</b>
            <div class="tones">
              {#each [1, 2, 3, 4, 5] as t (t)}
                <button
                  class="tone t{t}"
                  class:on={picks[i] === t}
                  class:right={checked && tones[i] === t}
                  class:wrong={checked && picks[i] === t && tones[i] !== t}
                  disabled={checked}
                  title={TONE_NAME[t as Tone]}
                  onclick={() => (picks[i] = t as Tone)}
                >{t === 5 ? '·' : ['ˉ', 'ˊ', 'ˇ', 'ˋ'][t - 1]}</button>
              {/each}
            </div>
          </div>
        {/each}
      </div>

      {#if !checked}
        <button class="btn primary" disabled={picks.some((p) => p === null)} onclick={check}>Kiểm tra</button>
      {:else}
        <div class="answer" data-has-pinyin>
          {picks.every((p, i) => p === tones[i]) ? 'Đúng' : 'Chưa đúng. Đáp án:'}
          <Pinyin text={word.pinyin} syllables={word.syllables} />
        </div>
      {/if}
    </div>

    <h2 class="section-title">Đọc to và so cao độ <span class="muted">(tham khảo)</span></h2>
    <div class="card speak">
      <div class="row">
        <button class="btn primary" disabled={recording} onclick={() => record()}><Icon name="mic" /> {recording ? 'Đang nghe…' : 'Ghi âm 2 giây'}</button>
        {#if result}<b class="big-score">{result.score}/100</b>{/if}
        <span class="spacer"></span>
        {#if checked}<button class="btn" onclick={next}>Từ tiếp →</button>{/if}
      </div>
      {#if micError}<p class="bad">{micError}</p>{/if}
      <svg viewBox="0 0 600 160" class="plot" aria-label="Đường cao độ">
        {#each tones as _, i (i)}
          <line x1={(i / tones.length) * 600} x2={(i / tones.length) * 600} y1="0" y2="160" class="sep" />
        {/each}
        <path d={path(template(tones), 600, 150)} class="tpl" transform="translate(0,5)" />
        {#if result}<path d={path(result.contour, 600, 150)} class="me" transform="translate(0,5)" />{/if}
      </svg>
      <p class="muted small">Nét đứt là đường thanh chuẩn, nét liền là giọng của bạn.<br />Điểm chỉ mang tính tham khảo: thời gian được chia đều cho các âm tiết và app không nhận dạng chữ.</p>
    </div>
  {:else if queue.length}
    <div class="card done"><div class="big"><Icon name="result-tones" /></div><h2>Đúng {score}/{queue.length} từ</h2><a class="btn primary" href="#/practice">Về trang luyện tập</a></div>
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
  .tone { width: 40px; height: 40px; border-radius: 12px; border: 2px solid var(--border); background: var(--surface); font-size: 22px; font-weight: 900; }
  .tone.on { border-color: var(--primary); background: var(--surface-2); }
  .tone.right { border-color: var(--good); background: color-mix(in srgb, var(--good) 18%, var(--surface)); }
  .tone.wrong { border-color: var(--bad); }
  .t1 { color: var(--tone1); } .t2 { color: var(--tone2); } .t3 { color: var(--tone3); } .t4 { color: var(--tone4); } .t5 { color: var(--tone5); }
  .answer { font-size: 20px; font-weight: 800; display: flex; gap: 8px; align-items: baseline; }
  .speak { display: flex; flex-direction: column; gap: 10px; }
  .big-score { font-size: 24px; color: var(--primary); }
  .plot { width: 100%; height: 170px; background: var(--surface-2); border-radius: 12px; }
  .sep { stroke: var(--border); stroke-width: 1.5; }
  .tpl { fill: none; stroke: var(--text-2); stroke-width: 3; stroke-dasharray: 8 6; }
  .me { fill: none; stroke: var(--primary); stroke-width: 3.5; stroke-linejoin: round; }
  .small { font-size: 12.5px; margin: 0; }
  .done { text-align: center; padding: 30px; }
  .done .big { font-size: 48px; }
  .done a { text-decoration: none; }
</style>
