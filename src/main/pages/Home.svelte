<script lang="ts">
  import { wordById } from '../../lib/data.ts';
  import { progress, streak, today } from '../../lib/progress.svelte.ts';
  import { TARGET_EXPOSURES } from '../../lib/scheduler.ts';
  import { settings } from '../../lib/settings.svelte.ts';
  import { isDue } from '../../lib/srs.ts';
  import Pinyin from '../../lib/ui/Pinyin.svelte';

  const hour = new Date().getHours();
  const greet = hour < 11 ? { vi: 'Chào buổi sáng!', zh: '早上好！' } : hour < 18 ? { vi: 'Chào buổi chiều!', zh: '下午好！' } : { vi: 'Chào buổi tối!', zh: '晚上好！' };

  const seenToday = $derived(progress.seenDays[today()] ?? 0);
  const due = $derived(Object.values(progress.srs).filter((c) => isDue(c)).length);
  const familiar = $derived(Object.values(progress.exposure).filter((e) => e.k || e.n >= TARGET_EXPOSURES).length);
  const days = $derived(streak());
  const recent = $derived(
    Object.entries(progress.exposure)
      .filter(([, e]) => e.n > 0)
      .sort((a, b) => b[1].t - a[1].t)
      .slice(0, 12)
      .map(([id]) => wordById.get(id))
      .filter((w) => !!w),
  );
</script>

<div class="page">
  <h1>{greet.vi} <span class="han zh">{greet.zh}</span></h1>
  <p class="lead">
    {#if settings.petEnabled}Tiểu Mai đang ở góc màn hình, mỗi từ hiện {settings.wordSec} giây rồi chuyển sang từ mới.
    {:else}Trợ lý đang tắt. Bật lại ở thanh bên trái để Tiểu Mai nhắc từ cho bạn nhé.{/if}
  </p>

  <div class="stats">
    <div class="card stat"><b>{seenToday}</b><span>lượt gặp từ hôm nay</span></div>
    <div class="card stat"><b>{days}</b><span>ngày học liên tiếp 🔥</span></div>
    <div class="card stat"><b>{familiar}</b><span>từ đã quen mặt</span></div>
    <a class="card stat link" href="#/review"><b>{due}</b><span>thẻ cần ôn ngay →</span></a>
  </div>

  <h2 class="section-title">Bắt đầu nhanh</h2>
  <div class="grid">
    <a class="card action" href="#/quiz/meaning"><span class="big">🧠</span><b>Đoán nghĩa</b><span class="muted">Nhìn chữ, chọn nghĩa đúng</span></a>
    <a class="card action" href="#/write"><span class="big">✍️</span><b>Viết theo nét</b><span class="muted">Tập viết đúng thứ tự nét</span></a>
    <a class="card action" href="#/tones"><span class="big">🎵</span><b>Luyện thanh điệu</b><span class="muted">Chọn thanh, ghi âm so cao độ</span></a>
    <a class="card action" href="#/review"><span class="big">🔁</span><b>Ôn tập</b><span class="muted">Thẻ ghi nhớ theo lịch FSRS</span></a>
  </div>

  <h2 class="section-title">Từ Tiểu Mai vừa cho bạn xem</h2>
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
    <p class="empty">Chưa có từ nào. Đợi Tiểu Mai một chút, hoặc bấm vào cô ấy để xem từ đầu tiên.</p>
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
