<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import { glass } from '../../lib/ui/glass/glass.ts';
  import { progress, streak, today } from '../../lib/progress.svelte.ts';
  import { TARGET_EXPOSURES } from '../../lib/scheduler.ts';
  import { openWord, settings } from '../../lib/settings.svelte.ts';
  import { HUE_OF, hueVar } from '../../lib/theme/themes.ts';
  import Pinyin from '../../lib/ui/Pinyin.svelte';
  import { reviewQueueIds } from '../review-queue.svelte.ts';

  const hour = new Date().getHours();
  const greet = hour < 11 ? { vi: 'Chào buổi sáng', zh: '早上好' } : hour < 18 ? { vi: 'Chào buổi chiều', zh: '下午好' } : { vi: 'Chào buổi tối', zh: '晚上好' };

  const seenToday = $derived(progress.seenDays[today()] ?? 0);
  const due = $derived(reviewQueueIds().length);
  const familiar = $derived(Object.entries(progress.exposure).filter(([id, e]) => (e.k || e.n >= TARGET_EXPOSURES) && openWord(id)).length);
  const days = $derived(streak());
  const recent = $derived(
    Object.entries(progress.exposure)
      .filter(([, e]) => e.n > 0)
      .sort((a, b) => b[1].t - a[1].t)
      .slice(0, 12)
      .map(([id]) => openWord(id))
      .filter((w) => !!w),
  );
</script>

<div class="page home">
  <h1>{greet.vi} <span class="han zh">{greet.zh}</span></h1>
  <p class="lead">Tiến độ học hôm nay, lối vào nhanh các bài luyện và những từ vừa gặp.</p>
  <!-- Out of the flow at the header's right: turning the panel off or on never moves the cards below. -->
  <div class="pet-note-slot" aria-live="polite">
    {#if !settings.petEnabled}<p class="pet-note glass-soft">Bảng gợi ý đang tắt.<br />Bật lại ở mục “Bảng gợi ý” bên trái.</p>{/if}
  </div>

  <div class="stats">
    <div class="card glass stat" style:--h={hueVar('blue')}><b>{seenToday}</b><span>lượt gặp từ hôm nay</span></div>
    <div class="card glass stat" style:--h={hueVar('orange')}><b>{days}</b><span>ngày học liên&nbsp;tiếp <Icon name="streak" /></span></div>
    <div class="card glass stat" style:--h={hueVar('teal')}><b>{familiar}</b><span>từ đã quen</span></div>
    <a class="card glass glass-lift stat link" use:glass={{ hover: true }} href="#/review" style:--h={hueVar(HUE_OF.review)}><b>{due}</b><span>thẻ cần ôn →</span></a>
  </div>

  <h2 class="section-title"><Icon name="nav-practice" hue={HUE_OF.practice} /> Bắt đầu nhanh</h2>
  <div class="grid">
    <a class="card glass glass-lift action" use:glass={{ hover: true }} href="#/quiz/meaning" style:--h={hueVar(HUE_OF.meaning)}><span class="disc"><Icon name="quiz-meaning" /></span><b>Đoán nghĩa</b><span class="muted">Nhìn chữ, chọn nghĩa đúng</span></a>
    <a class="card glass glass-lift action" use:glass={{ hover: true }} href="#/write" style:--h={hueVar(HUE_OF.write)}><span class="disc"><Icon name="write" /></span><b>Viết theo nét</b><span class="muted">Tập viết đúng thứ&nbsp;tự nét</span></a>
    <a class="card glass glass-lift action" use:glass={{ hover: true }} href="#/tones" style:--h={hueVar(HUE_OF.tones)}><span class="disc"><Icon name="tones" /></span><b>Luyện thanh điệu</b><span class="muted">Chọn thanh, ghi&nbsp;âm và so cao&nbsp;độ</span></a>
    <a class="card glass glass-lift action" use:glass={{ hover: true }} href="#/review" style:--h={hueVar(HUE_OF.review)}><span class="disc"><Icon name="nav-review" /></span><b>Ôn tập</b><span class="muted">Thẻ ghi nhớ theo lịch FSRS</span></a>
  </div>

  <h2 class="section-title"><Icon name="pet-open" hue={HUE_OF.home} /> Từ vừa gặp</h2>
  {#if recent.length}
    <div class="recent" data-has-pinyin>
      {#each recent as w (w.id)}
        <a class="card glass glass-lift mini" href="#/word/{encodeURIComponent(w.id)}">
          <span class="han hz">{w.hanzi}</span>
          <Pinyin text={w.pinyin} syllables={w.syllables} />
          <span class="vi">{w.vi}</span>
        </a>
      {/each}
    </div>
  {:else}
    <p class="empty">Chưa có từ nào.<br />Từ đầu tiên sẽ hiện trên bảng gợi ý.</p>
  {/if}
</div>

<style>
  /* Primary pulled toward the text colour: the light pinks and greens alone fall under 3:1 on the fields. */
  .zh { color: var(--primary-ink); font-size: 24px; margin-left: 6px; }
  .home { position: relative; }
  /* Level with the greeting and clear of the subtitle under it (two 18px lines end above it at every width). */
  .pet-note { position: absolute; top: 8px; right: 32px; max-width: 280px; margin: 0; padding: 5px 11px; border-radius: 12px;
    text-align: right; line-height: 18px; font-size: 13px; font-weight: 700; color: var(--text); --glass-alpha: 80%; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
  .stat { display: flex; flex-direction: column; gap: 2px; overflow: hidden; --glass-tint: color-mix(in srgb, var(--h) 8%, var(--surface)); }
  .stat.link:hover:not(:active) { --glass-tint: color-mix(in srgb, var(--h) var(--stat-hover, 16%), var(--surface)); }
  :global(:root[data-theme='dark']) .stat { --stat-hover: 28%; }
  /* The group colour as a short bar above the number; the card keeps its glass rim. */
  .stat::after { content: ''; position: absolute; top: 9px; left: 20px; width: 24px; height: 4px; border-radius: 2px; background: var(--h); }
  .stat b { font-size: 32px; font-weight: 900; color: var(--h); }
  .stat span { color: var(--text-2); font-weight: 700; font-size: 13.5px; }
  .stat span :global(.icon) { color: var(--h); }
  .link { text-decoration: none; }
  .action { display: flex; flex-direction: column; gap: 4px; text-decoration: none; color: var(--text); }
  .disc { font-size: 24px; margin-bottom: 4px; }
  .recent { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  .mini { display: flex; flex-direction: column; align-items: center; text-decoration: none; color: var(--text); padding: 12px; gap: 2px; }
  .mini .hz { font-size: 30px; }
  .mini .vi { font-size: 13px; font-weight: 800; text-align: center; }
</style>
