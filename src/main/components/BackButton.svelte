<script lang="ts">
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

<button class="back-btn" onclick={leave} title="{label} (Esc)">
  <span class="arrow" aria-hidden="true">←</span>{label}
</button>

<style>
  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    padding: 6px 16px 6px 8px;
    margin-bottom: 6px;
    border: 1.5px solid var(--border);
    border-radius: 99px;
    background: var(--surface);
    color: var(--text);
    font-size: 15px;
    font-weight: 800;
    cursor: pointer;
  }
  .back-btn:hover { background: var(--surface-2); border-color: var(--primary); }
  .back-btn:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  .arrow {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--primary);
    color: var(--on-primary);
    font-size: 16px;
    line-height: 1;
  }
</style>
