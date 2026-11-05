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
    background: var(--bg-2);
    border-bottom: 1.5px solid var(--border);
    user-select: none;
    flex: none;
  }
  .title {
    font-size: 13px;
    font-weight: 800;
    color: var(--text-2);
    flex: 1;
  }
  .title { display: flex; align-items: center; gap: 6px; }
  .logo { width: 22px; height: 22px; pointer-events: none; }
  .title .han { color: var(--primary); font-size: 16px; }
  .controls { display: flex; height: 100%; }
  .controls button {
    width: 46px;
    border: 0;
    background: none;
    color: var(--text-2);
    font-size: 13px;
  }
  .controls button:hover { background: var(--surface-2); color: var(--text); }
  .controls .close:hover { background: #e5484d; color: #fff; }
</style>
