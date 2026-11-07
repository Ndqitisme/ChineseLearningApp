<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import { HUE_OF } from '../../lib/theme/themes.ts';
  const ACCOUNT = '106875866606';
  let copyState = $state<'' | 'done' | 'failed'>('');
  let numEl = $state<HTMLElement>();
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  async function copy() {
    clearTimeout(resetTimer);
    try {
      await navigator.clipboard.writeText(ACCOUNT);
      copyState = 'done';
      resetTimer = setTimeout(() => (copyState = ''), 1600);
    } catch {
      // Clipboard refused: select the number so Ctrl+C still works.
      copyState = 'failed';
      if (numEl) getSelection()?.selectAllChildren(numEl);
    }
  }
</script>

<div class="page">
  <h1><Icon name="nav-support" hue={HUE_OF.support} /> Ủng hộ tác giả</h1>
  <p class="lead">Nếu bạn muốn ủng hộ tác giả để có kinh phí làm thêm những dự án phi lợi nhuận có ích cho cộng đồng trong tương lai.</p>

  <figure class="card qr">
    <img src="/support/bank-qr.jpg" alt="Mã VietQR tài khoản VietinBank 106875866606" width="1096" height="1237" />
    <figcaption>
      <div class="section-title">Số tài khoản ngân hàng</div>
      <div class="row acct">
        <span class="muted">VietinBank</span>
        <b class="num" bind:this={numEl}>{ACCOUNT}</b>
        <button class="btn copy" onclick={copy}>{copyState === 'done' ? 'Đã chép' : 'Chép'}</button>
      </div>
      {#if copyState === 'failed'}<p class="muted small">Không chép được. Số tài khoản đã được chọn, hãy bấm Ctrl+C.</p>{/if}
    </figcaption>
  </figure>
</div>

<style>
  .qr { width: fit-content; margin: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .qr img { display: block; width: 340px; height: auto; border-radius: 12px; }
  .section-title { margin: 10px 0 6px; text-align: center; text-transform: none; letter-spacing: normal; }
  .small { font-size: 12.5px; text-align: center; margin: 6px 0 0; }
  .acct { justify-content: center; gap: 8px; }
  .num { font-size: 18px; letter-spacing: .04em; user-select: text; }
  .copy { padding: 4px 12px; font-size: 13px; }
</style>
