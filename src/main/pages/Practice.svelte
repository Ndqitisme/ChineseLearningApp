<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import { glass } from '../../lib/ui/glass/glass.ts';
  import type { IconName } from '../../lib/ui/icon-names.ts';
  import { speechAvailable } from '../../lib/speech/index.ts';
  import { HUE_OF, hueVar, type Hue } from '../../lib/theme/themes.ts';
  import { reviewQueueIds } from '../review-queue.svelte.ts';

  const due = $derived(reviewQueueIds().length);
  const modes = $derived<{ href: string; icon: IconName; hue: Hue; title: string; desc: string; off?: boolean }[]>([
    { href: '#/quiz/meaning', icon: 'quiz-meaning', hue: HUE_OF.meaning, title: 'Đoán nghĩa', desc: 'Nhìn chữ Hán, chọn nghĩa tiếng Việt đúng.' },
    { href: '#/quiz/hanzi', icon: 'quiz-hanzi', hue: HUE_OF.hanzi, title: 'Chọn mặt chữ', desc: 'Đọc nghĩa tiếng Việt, tìm đúng chữ Hán.' },
    { href: '#/quiz/listen', icon: 'quiz-listen', hue: HUE_OF.listen, title: 'Nghe chọn chữ', desc: speechAvailable() ? 'Nghe phát âm, chọn chữ đúng.' : 'Cần cài giọng đọc trong Cài đặt.', off: !speechAvailable() },
    { href: '#/write', icon: 'write', hue: HUE_OF.write, title: 'Viết theo nét', desc: 'Vẽ từng nét đúng thứ tự, có gợi ý khi sai.' },
    { href: '#/build/order', icon: 'build', hue: HUE_OF.build, title: 'Ghép câu', desc: 'Sắp xếp từ thành câu, hoặc ghép câu trả lời cho câu hỏi.' },
    { href: '#/tones', icon: 'tones', hue: HUE_OF.tones, title: 'Thanh điệu', desc: 'Chọn thanh cho từng âm, ghi âm và so đường cao độ.' },
    { href: '#/review', icon: 'nav-review', hue: HUE_OF.review, title: `Ôn tập (${due})`, desc: 'Thẻ ghi nhớ, lịch ôn tự động theo FSRS.' },
  ]);
</script>

<div class="page">
  <h1>Luyện tập</h1>
  <p class="lead">Luyện nghĩa, mặt chữ, nghe, cách viết, thanh điệu và ghép câu.</p>
  <div class="grid">
    {#each modes as m (m.href)}
      <a class="card glass glass-lift mode" class:off={m.off} use:glass={{ hover: true, when: !m.off }} href={m.off ? '#/settings/voice' : m.href} style:--h={hueVar(m.hue)}>
        <span class="disc"><Icon name={m.icon} /></span><b>{m.title}</b><span class="muted">{m.desc}</span>
      </a>
    {/each}
  </div>
</div>

<style>
  .mode { display: flex; flex-direction: column; gap: 6px; text-decoration: none; color: var(--text); min-height: 140px; transition: transform .12s; }
  .mode:hover { transform: translateY(-2px); }
  .mode:active { transform: translateY(0); }
  /* Off: a thinner surface and a muted title; the helper text keeps its full colour. */
  .mode.off { --glass-alpha: 50%; --glass-rim-hi: .5; --glass-rim-mid: .15; }
  .mode.off b { color: var(--text-2); }
  /* html:root[data-theme] raises it above the shared hover and press rules and their dark variants, and above the hover
     tint, which would lighten the off card's face in dark themes. */
  :global(html:root[data-theme]) .mode.off:hover, :global(html:root[data-theme]) .mode.off:active { transform: none; --glass-alpha: 50%; --glass-rim-hi: .5; --glass-rim-mid: .15; --glass-rim-top: var(--glass-rim-w, 1px); --glass-shadow: initial;
    --glass-tint: color-mix(in srgb, var(--primary) var(--glass-tint-mix), var(--surface)); }
  @media (prefers-reduced-motion: reduce) { .mode, .mode:hover { transition: none; transform: none; } }
  .mode.off .disc { --h: var(--text-2); }
  .disc { font-size: 28px; margin-bottom: 2px; }
</style>
