<script lang="ts">
  import { progress } from '../../lib/progress.svelte.ts';
  import { speechAvailable } from '../../lib/speech/index.ts';
  import { isDue } from '../../lib/srs.ts';

  const due = $derived(Object.values(progress.srs).filter((c) => isDue(c)).length);
  const modes = $derived([
    { href: '#/quiz/meaning', icon: '🧠', title: 'Đoán nghĩa', desc: 'Nhìn chữ Hán, chọn nghĩa tiếng Việt đúng.' },
    { href: '#/quiz/hanzi', icon: '🔤', title: 'Chọn mặt chữ', desc: 'Đọc nghĩa tiếng Việt, tìm đúng chữ Hán.' },
    { href: '#/quiz/listen', icon: '👂', title: 'Nghe chọn chữ', desc: speechAvailable() ? 'Nghe phát âm, chọn chữ đúng.' : 'Cần cài giọng đọc trong Cài đặt.', off: !speechAvailable() },
    { href: '#/write', icon: '✍️', title: 'Viết theo nét', desc: 'Vẽ từng nét đúng thứ tự, có gợi ý khi sai.' },
    { href: '#/tones', icon: '🎵', title: 'Thanh điệu', desc: 'Chọn thanh cho từng âm, ghi âm và so đường cao độ.' },
    { href: '#/review', icon: '🔁', title: `Ôn tập (${due})`, desc: 'Thẻ ghi nhớ, lịch ôn tự động theo FSRS.' },
  ]);
</script>

<div class="page">
  <h1>Luyện tập</h1>
  <p class="lead">Mặc định luyện các từ Tiểu Mai đã cho bạn xem. Muốn luyện theo chủ đề, vào trang chủ đề rồi bấm nút luyện.</p>
  <div class="grid">
    {#each modes as m (m.href)}
      <a class="card mode" class:off={m.off} href={m.off ? '#/settings' : m.href}>
        <span class="big">{m.icon}</span><b>{m.title}</b><span class="muted">{m.desc}</span>
      </a>
    {/each}
  </div>
</div>

<style>
  .mode { display: flex; flex-direction: column; gap: 6px; text-decoration: none; color: var(--text); min-height: 140px; transition: transform .12s; }
  .mode:hover { transform: translateY(-2px); }
  .mode.off { opacity: .55; }
  .big { font-size: 34px; }
</style>
