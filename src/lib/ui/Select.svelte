<script lang="ts" generics="V extends string | number">
  import { glass } from './glass/glass.ts';

  /** A listbox on the app's glass, in place of the browser's native select list (square, opaque, system colours).
   *  Keyboard: arrows, Home/End, Enter or Space to pick, Esc to close, letters jump to the first matching option. */
  let { value, options, onchange, label, disabled = false }: {
    value: V;
    options: { value: V; label: string }[];
    onchange: (value: V) => void;
    label?: string;
    disabled?: boolean;
  } = $props();

  const id = `select-${Math.random().toString(36).slice(2, 9)}`;
  let open = $state(false);
  let active = $state(0);
  let root: HTMLDivElement;
  let trigger: HTMLButtonElement;
  let panel = $state<HTMLDivElement>();
  let typed = '';
  let typedAt = 0;

  const selectedIndex = $derived(Math.max(0, options.findIndex((o) => o.value === value)));
  const current = $derived(options[selectedIndex]?.label ?? '');

  function show() {
    active = selectedIndex;
    open = true;
    queueMicrotask(() => { panel?.focus(); scrollActive(); });
  }
  function close(refocus = true) {
    open = false;
    if (refocus) trigger?.focus();
  }
  function pick(i: number) {
    const o = options[i];
    close();
    if (o && o.value !== value) onchange(o.value);
  }
  function scrollActive() {
    panel?.querySelector(`#${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }
  function move(to: number) {
    active = Math.min(options.length - 1, Math.max(0, to));
    queueMicrotask(scrollActive);
  }

  function onTriggerKey(e: KeyboardEvent) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(); }
  }
  function onPanelKey(e: KeyboardEvent) {
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(active + 1),
      ArrowUp: () => move(active - 1),
      Home: () => move(0),
      End: () => move(options.length - 1),
      Enter: () => pick(active),
      ' ': () => pick(active),
      Escape: () => close(),
      Tab: () => close(false),
    };
    const k = keys[e.key];
    if (k) { if (e.key !== 'Tab') e.preventDefault(); k(); return; }
    // Type-ahead: letters typed within half a second build one prefix.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = performance.now();
      typed = (now - typedAt < 500 ? typed : '') + e.key.toLowerCase();
      typedAt = now;
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(typed));
      if (i >= 0) move(i);
    }
  }
  // Closes when focus leaves the whole control (Tab away, click elsewhere).
  function onFocusOut(e: FocusEvent) {
    if (open && !root.contains(e.relatedTarget as Node | null)) close(false);
  }
  function onWindowPointer(e: PointerEvent) {
    if (open && !root.contains(e.target as Node)) close(false);
  }
</script>

<svelte:window onpointerdown={onWindowPointer} />

<!-- The trigger sits on a card with the 4px nested corner (Settings): a deeper bezel folds into diagonal seams there. -->
<div class="select" class:open bind:this={root} onfocusout={onFocusOut}>
  <button
    type="button"
    class="select-trigger glass glass-press"
    use:glass={{ bezel: 4 }}
    bind:this={trigger}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-controls={id}
    aria-label={label}
    {disabled}
    onclick={() => (open ? close() : show())}
    onkeydown={onTriggerKey}
  ><span class="sizer" aria-hidden="true">{#each options as o (o.value)}<span>{o.label}</span>{/each}</span><span class="current">{current}</span></button>
  {#if open}
    <div
      class="panel glass"
      use:glass={{ blur: 10 }}
      role="listbox"
      {id}
      tabindex="-1"
      aria-label={label}
      aria-activedescendant="{id}-{active}"
      bind:this={panel}
      onkeydown={onPanelKey}
    >
      {#each options as o, i (o.value)}
        <!-- svelte-ignore a11y_click_events_have_key_events (the listbox handles the keys for its options) -->
        <div
          role="option"
          id="{id}-{i}"
          class="option"
          class:active={i === active}
          class:selected={i === selectedIndex}
          aria-selected={i === selectedIndex}
          tabindex="-1"
          onclick={() => pick(i)}
          onpointermove={() => (active = i)}
        >{o.label}</div>
      {/each}
    </div>
  {/if}
</div>

<style>
  /* inline-flex: no baseline gap under the trigger, so the row centres the label on it. */
  .select { position: relative; display: inline-flex; vertical-align: middle; }
  /* Every label stacked in one grid cell: the trigger takes the longest one's width, and the open list (which pads its
     options less than the trigger) fits inside that width exactly. */
  .select-trigger { display: inline-grid; align-items: center; }
  .sizer, .current { grid-area: 1 / 1; }
  /* Disabled: the greyed label of the row's other controls, on a fainter face (200 ms). */
  .select-trigger { transition: color .2s ease, opacity .2s ease; }
  .select-trigger:disabled { color: var(--text-2); opacity: .7; cursor: default; }
  @media (prefers-reduced-motion: reduce) { .select-trigger { transition: none; } }
  .sizer { display: grid; visibility: hidden; height: 0; overflow: hidden; }
  .sizer > span { grid-area: 1 / 1; }
  .panel {
    position: absolute;
    z-index: 30;
    top: calc(100% + 6px);
    left: 0;
    width: 100%;
    box-sizing: border-box;
    max-height: 244px;
    overflow-y: auto;
    padding: 4px;
    border-radius: max(10px, calc(var(--radius) - 2px));
    /* Opaque: below 100 % the chips of the card under the list still showed through between the options. */
    --glass-alpha: 100%;
    --glass-shadow: 0 2px 4px rgb(var(--glass-black) / .12), 0 10px 26px rgb(var(--glass-black) / .16);
    outline: none;
  }
  .option {
    padding: 7px 12px;
    border-radius: max(6px, calc(var(--radius) - 8px));
    white-space: nowrap;
    cursor: pointer;
    color: var(--text);
  }
  /* Apart by 2px, so the keyboard ring on one option does not merge with the chosen option's fill next to it. */
  .option + .option { margin-top: 2px; }
  .option.active { background: color-mix(in srgb, var(--surface-2) 90%, transparent); box-shadow: inset 0 1px 0 rgb(var(--glass-white) / .7); }
  /* The chosen option in the primary colour (its own label colour keeps 4.5:1 on it). */
  .option.selected { background: var(--primary); color: var(--on-primary); font-weight: 800; }
  .option.selected.active { background: color-mix(in srgb, var(--primary) 88%, var(--text)); }
  .panel:focus-visible .option.active:not(.selected) { outline: 2px solid var(--primary-ink); outline-offset: -2px; }
  @media (prefers-reduced-transparency: reduce) { .panel { background: var(--surface); } }
</style>
