<script lang="ts">
  import { glass } from '../../lib/ui/glass/glass.ts';
  import { back, go } from '../router.svelte.ts';

  interface Props {
    /** Parent page. With `useHistory`, only used when this window has no previous page. */
    to: string;
    label?: string;
    useHistory?: boolean;
  }
  let { to, label = 'Quay lại', useHistory = false }: Props = $props();

  const leave = () => (useHistory ? back(to) : go(to));

  function onKey(e: KeyboardEvent) {
    const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]');
    if (typing) return;
    if (e.key === 'Escape' || (e.altKey && e.key === 'ArrowLeft')) { e.preventDefault(); leave(); }
  }
</script>

<svelte:window onkeydown={onKey} />

<button class="back-btn glass glass-press" use:glass onclick={leave} title="{label} (Esc)">
  <span class="arrow" aria-hidden="true">←</span>{label}
</button>

<style>
  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    /* Left padding (height - disc) / 2: the arrow disc is concentric with the left cap. */
    padding: 6px 16px 6px 6px;
    margin-bottom: 6px;
    border: 0;
    border-radius: 99px;
    color: var(--text);
    font-size: 15px;
    font-weight: 800;
    cursor: pointer;
    --glass-alpha: 30%;
    /* It sits on the field's colour patch, which matched its hover face at the pills' tint. */
    --pill-hover-tint: 32%;
  }
  :global(:root[data-theme='dark']) .back-btn { --pill-hover-tint: 24%; }
  .arrow {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    /* The primary-fill rim and a short top sheen, clear of the arrow. */
    background: linear-gradient(to bottom, rgb(var(--glass-white) / .16), transparent 6px), var(--primary);
    box-shadow: inset 0 1px 0 rgb(var(--glass-white) / .45), inset 1px 0 0 rgb(var(--glass-white) / .22), inset 0 -1px 0 rgb(var(--glass-black) / .16), inset -1px 0 0 rgb(var(--glass-black) / .1);
    color: var(--on-primary);
    font-size: 16px;
    line-height: 1;
  }
</style>
