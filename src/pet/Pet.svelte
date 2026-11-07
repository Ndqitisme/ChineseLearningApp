<script lang="ts">
  import Icon from '../lib/ui/Icon.svelte';
  import { onMount, tick } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import {
    getCurrentWindow, LogicalSize, monitorFromPoint, PhysicalPosition, primaryMonitor, type Monitor,
  } from '@tauri-apps/api/window';
  import { loadLevels, studyPool, wordById } from '../lib/data.ts';
  import { EVENTS, ipc } from '../lib/ipc.ts';
  import { initProgress, progress, saveProgress, today } from '../lib/progress.svelte.ts';
  import { pickNext, recordExposure } from '../lib/scheduler.ts';
  import { openWord, settings, updateSettings } from '../lib/settings.svelte.ts';
  import { onSpeech, speak, speechAvailable } from '../lib/speech/index.ts';
  import Rig from '../lib/rig/Rig.svelte';
  import { FRAME, displayScale, loadRig, type HitRect } from '../lib/rig/load.ts';
  import { applyTheme } from '../lib/theme/apply.svelte.ts';
  import type { Word } from '../lib/types.ts';
  import Bubble from './Bubble.svelte';
  import { BASE_BUBBLE_ROOM, SHADOW_PAD, bubbleInset, defaultPlacement, snap, spriteOffset, windowSize, type Anchor, type Rect } from './geometry.ts';
  import HoverPinyin from '../lib/ui/HoverPinyin.svelte';

  const win = getCurrentWindow();
  // The rig plays the motion spec's state machine; every app event below is one of spec.stateMachine.events.
  let rig = $state<ReturnType<typeof Rig>>();
  const emit = (name: string, data?: object) => rig?.emit(name, data);
  // The rig mounts a tick after `ready`, so the start event goes out once it exists (it queues until drawn).
  let appStarted = false;
  $effect(() => { if (rig && !appStarted) { appStarted = true; rig.emit('appStart'); } });
  // True while the rig draws: the character's click-through rect is reported only then, so a canvas that
  // failed or lost its context never blocks clicks to what is underneath.
  let drawing = $state(false);
  $effect(() => { if (!settings.petCharacter) drawing = false; });

  let ready = $state(false);
  let anchor = $state<Anchor>({ h: 'right' });
  let bubble = $state<{ word: Word; revealed: boolean } | null>(null);
  let menuOpen = $state(false);
  let sleeping = $state(false);
  /** No word to show: nothing is turned on, or only levels that were re-locked. */
  let nothingOn = $state(false);
  let busy = $state(false);
  let hoveringBubble = false;
  let dragging = false;
  let movedSinceDrag = false;
  let recent: string[] = [];

  let spriteEl = $state<HTMLElement>();
  let bubbleEl = $state<HTMLElement>();
  let menuEl = $state<HTMLElement>();

  /** Visible character box inside the frame, known once rig.json has loaded. */
  let hit = $state<HitRect>({ x: 0, y: 0, w: 1, h: 1 });
  const spriteScale = $derived(displayScale(settings.petScale));
  // With the character hidden, the window holds only the bubble. The "sprite" then becomes a
  // zero-height strip along the window bottom, so placement and snapping keep working unchanged.
  const BUBBLE_ONLY_W = 264 + 2 * SHADOW_PAD;
  /** Grows when a bubble (long meaning, example sentence) needs more height than the default. */
  let bubbleRoom = $state(BASE_BUBBLE_ROOM);
  const spriteCss = $derived(
    !settings.petCharacter ? { w: BUBBLE_ONLY_W, h: 0 }
    : { w: Math.round(FRAME.w * spriteScale), h: Math.round(FRAME.h * spriteScale) },
  );
  // The art faces the image right; on the right edge it is mirrored so she looks toward the middle of the screen.
  const mirror = $derived(anchor.h === 'right');
  const visible = $derived(settings.petEnabled && !(busy && settings.hideOnFullscreen));
  const winCss = $derived(settings.petCharacter ? windowSize(spriteCss, bubbleRoom) : { w: BUBBLE_ONLY_W, h: bubbleRoom });
  const slotInset = $derived(settings.petCharacter ? bubbleInset(winCss, spriteCss, bubbleRoom) : { side: SHADOW_PAD, top: SHADOW_PAD, tail: 0 });
  const offset = $derived(spriteOffset(anchor, winCss, spriteCss));
  // Packs load once the shared settings unlock them; the main window does the unlocking.
  let loadedOpen = $state(settings.hskOpen);
  $effect(() => {
    const level = settings.hskOpen;
    loadLevels(level).then(() => { if (level > loadedOpen) loadedOpen = level; }, (e) => console.error('HSK pack', level, e));
  });
  const pool = $derived(studyPool(settings.topics, settings.hsk.filter((l) => l <= loadedOpen), settings.hskEdition));
  const starred = $derived(bubble ? !!progress.exposure[bubble.word.id]?.s : false);

  const nowMin = () => Date.now() / 60000;

  // ------------------------------------------------------------------ placement
  const workRect = (m: Monitor): Rect => ({
    x: m.workArea.position.x, y: m.workArea.position.y, w: m.workArea.size.width, h: m.workArea.size.height,
  });

  async function monitorForSprite(pos: { x: number; y: number }, scale: number) {
    const cx = pos.x + (offset.x + spriteCss.w / 2) * scale;
    const cy = pos.y + (offset.y + spriteCss.h / 2) * scale;
    return (await monitorFromPoint(cx, cy)) ?? (await primaryMonitor());
  }

  async function settle() {
    const pos = await win.outerPosition();
    const scale = await win.scaleFactor();
    const monitor = await monitorForSprite(pos, scale);
    if (!monitor) return;
    const r = snap({ windowPos: pos, scale, winCss, spriteCss, anchor, workArea: workRect(monitor) });
    anchor = r.anchor;
    if (Math.abs(r.pos.x - pos.x) > 1 || Math.abs(r.pos.y - pos.y) > 1) {
      await win.setPosition(new PhysicalPosition(r.pos.x, r.pos.y));
    }
    try { localStorage.setItem('petPlacement', JSON.stringify(r)); } catch { /* storage unavailable */ }
  }

  async function restorePlacement() {
    await win.setSize(new LogicalSize(winCss.w, winCss.h));
    const scale = await win.scaleFactor();
    let saved: { pos: { x: number; y: number }; anchor: Anchor } | null = null;
    try { saved = JSON.parse(localStorage.getItem('petPlacement') ?? 'null'); } catch { /* ignore */ }
    if (saved && (await monitorFromPoint(saved.pos.x + 10, saved.pos.y + 10))) {
      anchor = saved.anchor;
      await win.setPosition(new PhysicalPosition(saved.pos.x, saved.pos.y));
      await settle();
      return;
    }
    const monitor = await primaryMonitor();
    if (!monitor) return;
    const r = defaultPlacement(workRect(monitor), scale, winCss, spriteCss);
    anchor = r.anchor;
    await win.setPosition(new PhysicalPosition(r.pos.x, r.pos.y));
  }

  // ------------------------------------------------------------------ click-through regions
  async function reportHitRects() {
    await tick();
    const rects = [];
    if (spriteEl && drawing) {
      const r = spriteEl.getBoundingClientRect();
      const hx = mirror ? 1 - hit.x - hit.w : hit.x;
      rects.push({ x: r.x + r.width * hx, y: r.y + r.height * hit.y, w: r.width * hit.w, h: r.height * hit.h });
    }
    for (const el of [bubbleEl, menuEl]) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      rects.push({ x: r.x - 4, y: r.y - 4, w: r.width + 8, h: r.height + 14 });
    }
    await ipc.setHitRects(rects);
  }
  $effect(() => {
    void [ready, drawing, hit, mirror, sleeping, nothingOn, bubble, menuOpen, anchor.h, spriteCss, bubble?.revealed, settings.petCharacter];
    reportHitRects();
  });
  $effect(() => {
    // Fit the window to the bubble. Grow at once; shrink only after a clear drop so the window
    // does not resize on every word.
    const el = bubbleEl;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const needed = Math.ceil(el.offsetHeight) + 2 * SHADOW_PAD;
      if (needed > bubbleRoom || needed < bubbleRoom - 60) bubbleRoom = Math.max(BASE_BUBBLE_ROOM, needed);
    });
    ro.observe(el);
    return () => ro.disconnect();
  });
  $effect(() => {
    // A bubble removed under the cursor never gets pointerleave; don't let the flag stick.
    if (!bubble) hoveringBubble = false;
  });
  let menuWas = false;
  $effect(() => {
    // Open from the context menu; closed by an item, a blur or a drag start. She glances at the menu meanwhile.
    if (menuOpen === menuWas) return;
    menuWas = menuOpen;
    emit(menuOpen ? 'menuOpen' : 'menuClose');
  });

  // ------------------------------------------------------------------ scheduler loop
  let tickTimer: ReturnType<typeof setTimeout> | undefined;
  let swapTimer: ReturnType<typeof setTimeout> | undefined;
  let revealTimer: ReturnType<typeof setTimeout> | undefined;
  /** Between two words the bubble stays put; only its content fades out and back in. */
  const SWAP_MS = 1500;
  let swapping = $state(false);

  function scheduleTick(ms: number) {
    clearTimeout(tickTimer);
    tickTimer = setTimeout(loop, ms);
  }

  function inQuietHours(d = new Date()) {
    if (!settings.quietEnabled) return false;
    const m = d.getHours() * 60 + d.getMinutes();
    const [fh, fm] = settings.quietFrom.split(':').map(Number);
    const [th, tm] = settings.quietTo.split(':').map(Number);
    const from = fh * 60 + fm, to = th * 60 + tm;
    return from <= to ? m >= from && m < to : m >= from || m < to;
  }

  /** Sleep is a state the rig holds until userBack; it is sent once, never while already asleep. */
  function goSleep(why: 'longIdle' | 'quietHours') {
    if (sleeping) return;
    sleeping = true;
    closeBubble();
    emit(why);
  }
  function wake() {
    if (!sleeping) return;
    sleeping = false;
    emit('userBack');
  }

  async function loop() {
    if (!settings.petEnabled) return; // re-armed by the effect below when re-enabled
    if (progress.pausedUntil > Date.now() || inQuietHours()) {
      goSleep('quietHours');
      return scheduleTick(30_000);
    }
    const sys = await ipc.systemState().catch(() => ({ busy: false, idleSecs: 0 }));
    if (sys.busy || busy) return scheduleTick(5_000);
    if (settings.idlePauseMin > 0 && sys.idleSecs > settings.idlePauseMin * 60) {
      goSleep('longIdle');
      return scheduleTick(3_000);
    }
    wake();
    if (hoveringBubble || menuOpen || dragging) return scheduleTick(3_000);
    advance();
  }

  /** Next word: straight in if no bubble is open, otherwise a short fade inside the open bubble. */
  function advance() {
    clearTimeout(swapTimer);
    scheduleTick(settings.wordSec * 1000 + (bubble ? SWAP_MS : 0));
    if (!bubble) return showNext();
    swapping = true;
    swapTimer = setTimeout(() => { showNext(); swapping = false; }, SWAP_MS);
  }

  function showNext() {
    const now = nowMin();
    const due = Object.entries(progress.srs).filter(([id, c]) => Date.parse(c.due) <= Date.now() && openWord(id)).map(([id]) => id);
    const pick = pickNext({ pool, exposure: progress.exposure, due, recent, now });
    nothingOn = !pick;
    if (!pick) return closeBubble();
    const word = wordById.get(pick.id);
    if (!word) return;
    const seenBefore = (progress.exposure[pick.id]?.n ?? 0) >= 2;
    const revealed = !(settings.guessFirst && seenBefore);
    bubble = { word, revealed };

    recordExposure(progress.exposure, pick.id, now);
    progress.seenDays[today()] = (progress.seenDays[today()] ?? 0) + 1;
    saveProgress('exposure');
    saveProgress('seenDays');
    recent = [...recent.slice(-9), pick.id];

    // Guess mode: she ponders (chin on hand) while the learner tries to recall the meaning.
    emit(revealed ? 'wordShownRevealed' : 'wordShownGuess');
    clearTimeout(revealTimer);
    if (!revealed) revealTimer = setTimeout(reveal, 2600);
    if (settings.speech.autoplayInPet && speechAvailable()) speak(word.hanzi).catch(() => {});
  }

  function reveal() {
    if (!bubble || bubble.revealed) return;
    bubble = { ...bubble, revealed: true };
    emit('reveal');
  }

  function closeBubble() {
    clearTimeout(swapTimer);
    swapping = false;
    bubble = null;
  }

  function nextNow() {
    // While asleep the rig treats this as a userBack (wake, then wave); otherwise it is nothing.
    sleeping = false;
    emit('nextNow');
    advance();
  }

  // ------------------------------------------------------------------ exposure edits (this window owns them)
  function patchExposure(id: string, patch: { known?: boolean; starred?: boolean }) {
    const e = progress.exposure[id] ?? { n: 0, t: nowMin() };
    const next = { ...e };
    if (patch.known !== undefined) { if (patch.known) next.k = 1; else delete next.k; }
    if (patch.starred !== undefined) { if (patch.starred) next.s = 1; else delete next.s; }
    progress.exposure[id] = next;
    saveProgress('exposure');
  }

  // ------------------------------------------------------------------ pointer: click vs drag
  let down: { x: number; y: number } | null = null;

  // Drag starts from the character or from any part of the bubble that is not a button.
  function onDragDown(e: PointerEvent) {
    if (e.button !== 0) return;
    down = { x: e.screenX, y: e.screenY };
    menuOpen = false;
  }
  function onDragMove(e: PointerEvent) {
    if (!down || !(e.buttons & 1)) return;
    if (Math.hypot(e.screenX - down.x, e.screenY - down.y) < 4) return;
    down = null;
    dragging = true;
    movedSinceDrag = false;
    emit('dragStart');
    win.startDragging().finally(() => {
      // If the OS drag ended without moving the window, no Moved event will clear the flag.
      setTimeout(() => { if (dragging && !movedSinceDrag) { dragging = false; emit('dragEnd'); } }, 1200);
    });
  }
  function onSpriteUp() {
    if (!down) return;
    down = null;
    resume();
  }
  function resume() {
    emit('click');
    if (sleeping) { progress.pausedUntil = 0; saveProgress('pausedUntil'); wake(); }
    nextNow();
  }
  function onSpriteEnter() {
    emit('hoverEnter');
  }

  // ------------------------------------------------------------------ menu actions
  async function pauseFor(minutes: number) {
    progress.pausedUntil = minutes ? Date.now() + minutes * 60_000 : 0;
    await saveProgress('pausedUntil');
    menuOpen = false;
    if (minutes) goSleep('quietHours');
    else { wake(); nextNow(); }
  }
  async function hidePet() {
    menuOpen = false;
    await updateSettings({ petEnabled: false });
  }
  async function toggleCharacter() {
    menuOpen = false;
    await updateSettings({ petCharacter: !settings.petCharacter });
  }

  // ------------------------------------------------------------------ lifecycle
  let shown = false, hiddenBefore = false;
  $effect(() => {
    // The only place that shows/hides the window: assistant toggled (here, tray, settings) or a
    // fullscreen app appearing/leaving. Re-showing always restarts the scheduler loop.
    if (!ready) return;
    if (visible) {
      if (!shown) {
        shown = true;
        win.show();
        scheduleTick(1500);
        if (hiddenBefore) emit('fullscreenShow');
      }
    } else if (shown) {
      shown = false;
      hiddenBefore = true;
      clearTimeout(tickTimer);
      closeBubble();
      win.hide();
      emit('fullscreenHide');
    }
  });

  /** Resize for a new size setting or character on/off, keeping the bottom corner on her side put. */
  async function resizeKeepingCorner() {
    const pos = await win.outerPosition();
    const size = await win.outerSize();
    const scale = await win.scaleFactor();
    await win.setSize(new LogicalSize(winCss.w, winCss.h));
    const w = Math.round(winCss.w * scale), h = Math.round(winCss.h * scale);
    const x = anchor.h === 'right' ? pos.x + size.width - w : pos.x;
    await win.setPosition(new PhysicalPosition(x, pos.y + size.height - h));
    await settle();
  }
  let lastWin = '';
  $effect(() => {
    const key = `${winCss.w}x${winCss.h}`;
    if (!ready || key === lastWin) return;
    lastWin = key;
    resizeKeepingCorner();
  });

  onMount(() => {
    const unlisten: Promise<() => void>[] = [];
    (async () => {
      await initProgress();
      applyTheme();
      await restorePlacement();
      lastWin = `${winCss.w}x${winCss.h}`;
      ready = true;
    })();
    loadRig().then((a) => (hit = a.hit), () => {});
    const unlistenSpeech = onSpeech((phase, token) => emit(phase === 'start' ? 'speakStart' : 'speakEnd', { token }));

    let moveTimer: ReturnType<typeof setTimeout> | undefined;
    unlisten.push(win.onMoved(() => {
      // No drag-end event exists: treat ~250 ms without movement as the drop.
      movedSinceDrag = true;
      clearTimeout(moveTimer);
      moveTimer = setTimeout(async () => {
        await settle();
        if (dragging) { dragging = false; emit('dragEnd'); }
      }, 250);
    }));
    unlisten.push(win.onScaleChanged(() => settle()));
    unlisten.push(listen<string>(EVENTS.trayCommand, ({ payload }) => {
      if (payload === 'toggle-pet') updateSettings({ petEnabled: !settings.petEnabled });
      else if (payload === 'next') { if (!settings.petEnabled) updateSettings({ petEnabled: true }); nextNow(); }
      else if (payload === 'pause') pauseFor(30);
      else if (payload === 'resume') pauseFor(0);
    }));
    unlisten.push(listen<boolean>(EVENTS.systemBusy, ({ payload }) => (busy = payload)));
    unlisten.push(listen<{ id: string; known?: boolean; starred?: boolean }>(EVENTS.exposurePatch, ({ payload }) =>
      patchExposure(payload.id, payload),
    ));
    const onBlur = () => (menuOpen = false);
    window.addEventListener('blur', onBlur);

    return () => {
      unlisten.forEach((u) => u.then((f) => f()));
      unlistenSpeech();
      window.removeEventListener('blur', onBlur);
      clearTimeout(tickTimer);
      clearTimeout(swapTimer);
    };
  });
</script>

<div class="stage" style:width="{winCss.w}px" style:height="{winCss.h}px">
  {#if bubble || (sleeping && !settings.petCharacter) || (nothingOn && !sleeping)}
    <div
      class="bubble-slot"
      bind:this={bubbleEl}
      role="presentation"
      style:left={anchor.h === 'left' ? `${slotInset.side}px` : null}
      style:right={anchor.h === 'right' ? `${slotInset.side}px` : null}
      style:top="{slotInset.top}px"
      oncontextmenu={(e) => { e.preventDefault(); menuOpen = !menuOpen; }}
    >
      {#if bubble}
      <Bubble
        word={bubble.word}
        revealed={bubble.revealed}
        {swapping}
        {anchor}
        {starred}
        canSpeak={speechAvailable()}
        tail={settings.petCharacter}
        tailTop={slotInset.tail}
        showHanviet={settings.showHanviet}
        showExample={settings.showExample}
        onopen={() => ipc.openMain(`/word/${encodeURIComponent(bubble!.word.id)}`)}
        onspeak={() => bubble && speak(bubble.word.hanzi).catch(() => {})}
        onsetupvoice={() => ipc.openMain('/settings/voice')}
        onhandledown={onDragDown}
        onhandlemove={onDragMove}
        onknown={() => { if (bubble) patchExposure(bubble.word.id, { known: true }); emit('known'); nextNow(); }}
        onstar={() => bubble && patchExposure(bubble.word.id, { starred: !starred })}
        onreveal={reveal}
        onhover={(inside) => { hoveringBubble = inside; if (inside) emit('hoverBubble'); }}
      />
      {:else if !sleeping}
        <button class="nap" onclick={() => ipc.openMain('/topics')}><Icon name="bell" /> Chưa bật chủ đề nào, bấm để chọn chủ đề</button>
      {:else}
        <button class="nap" onclick={resume}><Icon name="pet-sleep" /> Đang tạm dừng, bấm để tiếp tục</button>
      {/if}
    </div>
  {/if}

  {#if menuOpen}
    <div
      class="menu"
      bind:this={menuEl}
      onanimationend={reportHitRects}
      role="menu"
      tabindex="-1"
      style:left={anchor.h === 'left' ? `${settings.petCharacter ? spriteCss.w * 0.7 : 6}px` : null}
      style:right={anchor.h === 'right' ? `${settings.petCharacter ? spriteCss.w * 0.7 : 6}px` : null}
      style:bottom="{settings.petCharacter ? spriteCss.h * 0.45 : 6}px"
    >
      <button role="menuitem" onclick={() => { menuOpen = false; nextNow(); }}><Icon name="pet-next" /> Từ tiếp theo</button>
      {#if progress.pausedUntil > Date.now()}
        <button role="menuitem" onclick={() => pauseFor(0)}><Icon name="play" /> Tiếp tục</button>
      {:else}
        <button role="menuitem" onclick={() => pauseFor(30)}><Icon name="pet-sleep" /> Tạm dừng 30 phút</button>
      {/if}
      <button role="menuitem" onclick={() => { menuOpen = false; ipc.openMain(); }}><Icon name="pet-open" /> Mở Tiểu Mai</button>
      <button role="menuitem" onclick={toggleCharacter}><Icon name={settings.petCharacter ? 'pet-hide-character' : 'pet-show-character'} /> {settings.petCharacter ? 'Ẩn Tiểu Mai, giữ bảng từ' : 'Hiện lại Tiểu Mai'}</button>
      <button role="menuitem" onclick={hidePet}><Icon name="pet-hide" /> Ẩn trợ lý</button>
    </div>
  {/if}

  {#if settings.petCharacter}
  <div
    class="sprite-slot"
    class:sleeping
    bind:this={spriteEl}
    style:left="{offset.x}px"
    style:top="{offset.y}px"
    role="button"
    tabindex="-1"
    aria-label="Tiểu Mai — bấm để xem từ mới, kéo để di chuyển, chuột phải để mở menu"
    onpointerdown={onDragDown}
    onpointermove={onDragMove}
    onpointerup={onSpriteUp}
    onpointerenter={onSpriteEnter}
    oncontextmenu={(e) => { e.preventDefault(); menuOpen = !menuOpen; }}
  >
    {#if ready}<Rig bind:this={rig} scale={spriteScale} {mirror} hidden={!visible} onready={() => { drawing = true; if (sleeping) emit('longIdle'); }} onlost={() => (drawing = false)} />{/if}
    {#if sleeping}<span class="zzz" aria-hidden="true">z<small>z</small></span>{/if}
  </div>
  {/if}
</div>

<HoverPinyin />

<!-- A press on the bubble that never became a drag must not linger. -->
<svelte:window onpointerup={() => (down = null)} />

<style>
  :global(html), :global(body) {
    background: transparent !important;
    user-select: none;
  }
  .stage {
    position: relative;
    overflow: hidden;
    /* small enough to fit in SHADOW_PAD: past the window edge a shadow is cut off in a hard line */
    --pet-shadow: 0 2px 9px rgba(0, 0, 0, 0.22);
  }
  .sprite-slot {
    position: absolute;
    cursor: grab;
    outline: none;
  }
  .bubble-slot {
    position: absolute;
  }
  .nap {
    border: 2px solid var(--bubble-border);
    border-radius: 99px;
    background: var(--bubble-bg);
    color: var(--bubble-text);
    box-shadow: var(--pet-shadow);
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }
  .menu {
    position: absolute;
    display: flex;
    flex-direction: column;
    min-width: 168px;
    padding: 6px;
    background: var(--surface);
    border: 2px solid var(--bubble-border);
    border-radius: 14px;
    box-shadow: var(--pet-shadow);
    animation: pop 0.16s ease-out;
  }
  .menu button {
    border: 0;
    background: none;
    text-align: left;
    padding: 6px 10px;
    border-radius: 9px;
    font-size: 13.5px;
    font-weight: 700;
    color: var(--text);
  }
  .menu button:hover { background: var(--surface-2); }
  @keyframes pop { from { transform: scale(0.85); opacity: 0; } }
  .zzz {
    position: absolute;
    top: 6%;
    right: 12%;
    font-weight: 900;
    font-size: 20px;
    color: var(--primary);
  }
  .zzz small { font-size: 14px; margin-left: 2px; }
</style>
