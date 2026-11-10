<script lang="ts">
  import Icon from '../../lib/ui/Icon.svelte';
  import { glass } from '../../lib/ui/glass/glass.ts';
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

  <figure class="card glass qr">
    <img src="/support/bank-qr.jpg" alt="Mã VietQR tài khoản VietinBank 106875866606" width="1096" height="1237" />
    <figcaption>
      <div class="section-title">Số tài khoản ngân hàng</div>
      <div class="row acct">
        <span class="muted">VietinBank</span>
        <b class="num" bind:this={numEl}>{ACCOUNT}</b>
        <!-- The longer label is laid out unseen in the same cell (::after, from data-wide), so the pill keeps its width and the row does not shift. -->
        <button use:glass class="btn glass glass-press copy" onclick={copy}><span class="labels" data-wide="Đã chép"><span>{copyState === 'done' ? 'Đã chép' : 'Chép'}</span></span></button>
      </div>
      {#if copyState === 'failed'}<p class="muted small">Không chép được. Số tài khoản đã được chọn, hãy bấm Ctrl+C.</p>{/if}
    </figcaption>
  </figure>
</div>

<style>
  /* The plate runs to the card's edge (1px in, inside the rim), so its corners can be nearly the card's own: the white QR
     tile in it has corners of about 20px, and a plate padded like the card's content got 4px ones, far squarer than the
     tile it holds. */
  .qr { width: fit-content; margin: 0; padding: 1px 1px 18px; display: flex; flex-direction: column; align-items: center; gap: 4px; }
  /* The bitmap holds the plate (corner radius about 20px here) inside a pastel frame. The clip drops the frame and 6px of
     the plate on each side, past its round corners, and rounds it to the card radius less the 1px inset; the negative
     margins give back the clipped space. */
  .qr img {
    display: block; width: 400px; height: auto;
    clip-path: inset(21px 29px 34px 32px round calc(var(--radius) - 1px));
    margin: -21px -29px -34px -32px;
  }
  .section-title { margin: 10px 0 6px; text-align: center; text-transform: none; letter-spacing: normal; }
  .small { font-size: 12.5px; text-align: center; margin: 6px 0 0; }
  .acct { justify-content: center; gap: 8px; }
  .labels { display: grid; }
  .labels > span, .labels::after { grid-area: 1 / 1; text-align: center; }
  .labels::after { content: attr(data-wide); visibility: hidden; }
  .num { font-size: 18px; letter-spacing: .04em; user-select: text; }
  /* 14px from the number, so the focus ring (4px out) stays 10px clear of the digits. */
  .copy { padding: 4px 12px; font-size: 13px; margin-left: 6px; }
</style>
