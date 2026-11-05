<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import { progress, streak, today } from '../../lib/progress.svelte.ts';
  import { TARGET_EXPOSURES } from '../../lib/scheduler.ts';
  import { openWord, settings } from '../../lib/settings.svelte.ts';
  import Pinyin from '../../lib/ui/Pinyin.svelte';
  import { reviewQueueIds } from '../review-queue.ts';

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

<div class="page">
  <h1>{greet.vi} <span class="han zh">{greet.zh}</span></h1>
  <p class="lead">
    Tiến độ học hôm nay, lối vào nhanh các bài luyện và những từ vừa gặp.
    {#if !settings.petEnabled}<br />Trợ lý đang tắt. Bật lại ở mục “Trợ lý trên màn hình” bên trái.{/if}
  </p>

  <div class="stats">
    <div class="card stat"><b>{seenToday}</b><span>lượt gặp từ hôm nay</span></div>
    <div class="card stat"><b>{days}</b><span>ngày học liên tiếp <Icon name="streak" /></span></div>
    <div class="card stat"><b>{familiar}</b><span>từ đã quen</span></div>
    <a class="card stat link" href="#/review"><b>{due}</b><span>thẻ cần ôn →</span></a>
  </div>

  <h2 class="section-title">Bắt đầu nhanh</h2>
  <div class="grid">
    <a class="card action" href="#/quiz/meaning"><span class="big"><Icon name="quiz-meaning" /></span><b>Đoán nghĩa</b><span class="muted">Nhìn chữ, chọn nghĩa đúng</span></a>
    <a class="card action" href="#/write"><span class="big"><Icon name="write" /></span><b>Viết theo nét</b><span class="muted">Tập viết đúng thứ tự nét</span></a>
    <a class="card action" href="#/tones"><span class="big"><Icon name="tones" /></span><b>Luyện thanh điệu</b><span class="muted">Chọn thanh, ghi âm và so cao độ</span></a>
    <a class="card action" href="#/review"><span class="big"><Icon name="nav-review" /></span><b>Ôn tập</b><span class="muted">Thẻ ghi nhớ theo lịch FSRS</span></a>
  </div>

  <h2 class="section-title">Từ vừa gặp</h2>
  {#if recent.length}
    <div class="recent" data-has-pinyin>
      {#each recent as w (w.id)}
        <a class="card mini" href="#/word/{encodeURIComponent(w.id)}">
          <span class="han hz">{w.hanzi}</span>
          <Pinyin text={w.pinyin} syllables={w.syllables} />
          <span class="vi">{w.vi}</span>
        </a>
      {/each}
    </div>
  {:else}
    <p class="empty">Chưa có từ nào. Bấm vào trợ lý trên màn hình để xem từ đầu tiên.</p>
  {/if}
</div>

<style>
  .zh { color: var(--primary); font-size: 24px; margin-left: 6px; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
  .stat { display: flex; flex-direction: column; gap: 2px; }
  .stat b { font-size: 32px; font-weight: 900; color: var(--primary); }
  .stat span { color: var(--text-2); font-weight: 700; font-size: 13.5px; }
  .link { text-decoration: none; }
  .action { display: flex; flex-direction: column; gap: 4px; text-decoration: none; color: var(--text); transition: transform .12s; }
  .action:hover { transform: translateY(-2px); }
  .big { font-size: 28px; }
  .recent { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  .mini { display: flex; flex-direction: column; align-items: center; text-decoration: none; color: var(--text); padding: 12px; gap: 2px; }
  .mini .hz { font-size: 30px; }
  .mini .vi { font-size: 13px; font-weight: 800; text-align: center; }
</style>
