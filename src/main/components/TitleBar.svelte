<script lang="ts">
  import { getCurrentWindow } from '@tauri-apps/api/window';
  const win = getCurrentWindow();
</script>

<header class="titlebar" data-tauri-drag-region>
  <span class="title" data-tauri-drag-region><img class="logo" src="/logo/icon.png" alt="" /><span class="han">小梅</span> TieuMai - Chinese Learning</span>
  <div class="controls">
    <button onclick={() => win.minimize()} aria-label="Thu nhỏ">—</button>
    <button onclick={() => win.toggleMaximize()} aria-label="Phóng to">▢</button>
    <button class="close" onclick={() => win.close()} aria-label="Đóng (app vẫn chạy ở khay hệ thống)">✕</button>
  </div>
</header>

<style>
  .titlebar {
    height: 36px;
    display: flex;
    align-items: center;
    padding-left: 14px;
    background: color-mix(in srgb, var(--bg-2) 72%, transparent);
    backdrop-filter: blur(12px) saturate(1.3);
    border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    box-shadow: inset 0 1px 0 rgb(var(--glass-white) / calc(var(--glass-sheen) * .7));
    user-select: none;
    flex: none;
  }
  @media (prefers-reduced-transparency: reduce) {
    .titlebar { background: var(--bg-2); backdrop-filter: none; box-shadow: none; border-bottom-color: var(--border); }
  }
  .title {
    font-size: 13px;
    font-weight: 800;
    color: color-mix(in srgb, var(--text-2) 70%, var(--text));
    flex: 1;
  }
  .title { display: flex; align-items: center; gap: 6px; }
  .logo { width: 22px; height: 22px; pointer-events: none; }
  /* Thin Kai strokes in Hoa anh đào's pink ink reached 3.9:1 (stroke core); bold in every theme so the mark keeps one weight. */
  .title .han { color: var(--primary-ink); font-size: 16px; font-weight: 600; }
  .controls { display: flex; height: 100%; }
  .controls button {
    width: 46px;
    border: 0;
    background: none;
    color: var(--text-2);
    font-size: 13px;
  }
  .controls button:hover { background: color-mix(in srgb, var(--surface) 60%, transparent); color: var(--text); }
  :global(:root[data-theme='dark']) .controls button:hover:not(.close):not(:active) { background: color-mix(in srgb, var(--text) 10%, transparent); }
  .controls button:focus-visible { outline: 2px solid var(--primary); outline-offset: -3px; }
  .controls .close:hover { background: #e5484d; color: #fff; }
  /* Press, as Windows draws its caption buttons: a deeper fill. */
  .controls button:active { background: color-mix(in srgb, var(--text) 16%, transparent); }
  .controls .close:active { background: #c13438; color: #fff; }
</style>
