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
  import { openWordAnyEdition, settings, updateSettings } from '../lib/settings.svelte.ts';
  import { onSpeech, speak, speechAvailable } from '../lib/speech/index.ts';
  import Rig from '../lib/rig/Rig.svelte';
  import { FRAME, displayScale, loadRig, type HitRect } from '../lib/rig/load.ts';
  import { applyTheme } from '../lib/theme/apply.svelte.ts';
  import type { Word } from '../lib/types.ts';
  import Bubble from './Bubble.svelte';
  import {
    BASE_BUBBLE_ROOM, SHADOW_PAD, bubbleInset, defaultPlacement, snap, spotOf, spriteOffset, windowAt, windowSize, type Anchor, type Rect, type Spot,
  } from './geometry.ts';
  import { inQuietWindow, quietWindowEnd } from './quiet.ts';
  import HoverPinyin from '../lib/ui/HoverPinyin.svelte';

  const win = getCurrentWindow();
  // The rig plays the motion spec's state machine; every app event below is one of spec.stateMachine.events.
  let rig = $state<ReturnType<typeof Rig>>();
  const emit = (name: string, data?: object) => rig?.emit(name, data);
  // The rig mounts a tick after `ready`, so the start event goes out once it exists (it queues until drawn).
  let appStarted = false;
  $effect(() => { if (rig && !appStarted) { appStarted = true; rig.emit('appStart'); } });
  /** A rebuilt or fresh rig scheduler starts awake with no menu: tell it what is held now. */
  function resendHeldState() {
    if (sleeping) emit('longIdle');
    if (menuOpen) emit('menuOpen');
  }
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
    const saved: SavedPlacement = { spot: spotOf(r.pos, scale, winCss, spriteCss, r.anchor), anchor: r.anchor };
    try { localStorage.setItem(PLACEMENT_KEY, JSON.stringify(saved)); } catch { /* storage unavailable */ }
  }

  // Saved as where her feet are, not as the window's top-left: the window's height follows the bubble, so a
  // top-left restored with another height leaves her floating. 'petPlacement' holds top-left values; not read.
  const PLACEMENT_KEY = 'petPlacement2';
  interface SavedPlacement { spot: Spot; anchor: Anchor }

  async function restorePlacement() {
    await win.setSize(new LogicalSize(winCss.w, winCss.h));
    const scale = await win.scaleFactor();
    let saved: SavedPlacement | null = null;
    try { saved = JSON.parse(localStorage.getItem(PLACEMENT_KEY) ?? 'null'); } catch { /* ignore */ }
    if (saved?.spot && (await monitorFromPoint(saved.spot.x + 10, saved.spot.bottom - 10))) {
      anchor = saved.anchor;
      const pos = windowAt(saved.spot, scale, winCss, spriteCss, saved.anchor);
      await win.setPosition(new PhysicalPosition(pos.x, pos.y));
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
  // A new window size reports again once the resize is applied (see resizing below), and the bubble's own size
  // changes (example line, Hán Việt, theme, custom CSS) through its ResizeObserver.
  $effect(() => {
    void [ready, drawing, hit, mirror, sleeping, nothingOn, bubble, menuOpen, anchor.h, spriteCss, bubble?.revealed, settings.petCharacter,
      bubbleRoom, settings.showExample, settings.showHanviet, settings.theme, settings.mode, settings.customCss, menuBottom];
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
      reportHitRects();
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

  /** Set by "Tiếp tục" during quiet hours: she stays awake until that quiet window ends or the user pauses again. */
  let quietSkippedUntil = 0;
  function inQuietHours(d = new Date()) {
    return settings.quietEnabled && d.getTime() >= quietSkippedUntil && inQuietWindow(d, settings.quietFrom, settings.quietTo);
  }
  /** Paused from the menu or tray, or in quiet hours: the menu then offers "Tiếp tục". */
  const paused = () => progress.pausedUntil > Date.now() || inQuietHours();

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

  /** Idle this long means nobody is looking: words still change, but the showings do not count. */
  const AWAY_SECS = 60;

  async function loop() {
    if (!settings.petEnabled) return; // re-armed by the effect below when re-enabled
    if (progress.pausedUntil > Date.now() || inQuietHours()) {
      goSleep('quietHours');
      return scheduleTick(30_000);
    }
    // The system:busy event can fire before this window listens, so the poll sets busy too. While a fullscreen
    // app hides her the loop keeps polling, so she comes back even if the event that it closed was missed.
    const sys = await ipc.systemState().catch(() => null);
    if (sys) busy = sys.busy;
    if (!visible) return scheduleTick(5_000);
    if (!shown) return; // visible again this moment: the show effect restarts the loop
    if (busy) return scheduleTick(5_000);
    const idleSecs = sys?.idleSecs ?? 0;
    if (settings.idlePauseMin > 0 && idleSecs > settings.idlePauseMin * 60) {
      goSleep('longIdle');
      return scheduleTick(3_000);
    }
    wake();
    if (hoveringBubble || menuOpen || dragging) return scheduleTick(3_000);
    advance(idleSecs < AWAY_SECS);
  }

  /** Next word: straight in if no bubble is open, otherwise a short fade inside the open bubble.
   * `seen`: someone is at the computer, so the showing counts. */
  function advance(seen: boolean) {
    clearTimeout(swapTimer);
    scheduleTick(settings.wordSec * 1000 + (bubble ? SWAP_MS : 0));
    if (!bubble) return showNext(seen);
    swapping = true;
    swapTimer = setTimeout(() => { showNext(seen); swapping = false; }, SWAP_MS);
  }

  function showNext(seen: boolean) {
    const now = nowMin();
    const due = Object.entries(progress.srs).filter(([id, c]) => Date.parse(c.due) <= Date.now() && openWordAnyEdition(id)).map(([id]) => id);
    const next = pickNext({ pool, exposure: progress.exposure, due, recent, now });
    nothingOn = !next && !pool.length && !due.length;
    if (nothingOn) return closeBubble();
    // No pick from a non-empty pool: a tiny pool whose every word waits out its gap. The word on screen stays;
    // with none on screen, the last one shown comes back, not counted, so she never stands there empty.
    if (!next && bubble) return;
    const again = next ? undefined : lastShown();
    const pick = next ?? (again && { id: again, reason: 'learning' as const });
    if (!pick) return;
    const word = wordById.get(pick.id);
    if (!word) return;
    const seenBefore = (progress.exposure[pick.id]?.n ?? 0) >= 2;
    const revealed = !(settings.guessFirst && seenBefore);
    bubble = { word, revealed };

    // Only showings someone could see count: not while hidden, switched off or with nobody at the computer.
    if (seen && visible && !again) {
      recordExposure(progress.exposure, pick.id, now);
      progress.seenDays[today()] = (progress.seenDays[today()] ?? 0) + 1;
      saveProgress('exposure');
      saveProgress('seenDays');
    }
    recent = [...recent.slice(-9), pick.id];

    // Guess mode: she ponders (chin on hand) while the learner tries to recall the meaning.
    emit(revealed ? 'wordShownRevealed' : 'wordShownGuess');
    clearTimeout(revealTimer);
    if (!revealed) revealTimer = setTimeout(reveal, 2600);
    else autoplay(word);
  }

  /** The pool word shown most recently: this run's last, or after a restart the latest in the saved exposures. */
  function lastShown(): string | undefined {
    const inPool = new Set(pool);
    const last = recent.at(-1);
    if (last && inPool.has(last)) return last;
    let best: string | undefined, t = -Infinity;
    for (const id of pool) {
      const e = progress.exposure[id];
      if (e && e.t > t) { best = id; t = e.t; }
    }
    return best;
  }

  /** In guess mode the word is read only once the meaning shows: hearing it first gives the reading away. */
  function autoplay(word: Word) {
    if (settings.speech.autoplayInPet && speechAvailable()) speak(word.hanzi).catch(() => {});
  }

  function reveal() {
    if (!bubble || bubble.revealed) return;
    bubble = { ...bubble, revealed: true };
    emit('reveal');
    autoplay(bubble.word);
  }

  function closeBubble() {
    clearTimeout(swapTimer);
    swapping = false;
    bubble = null;
  }

  function nextNow() {
    // Hidden by a fullscreen app nobody sees a word, so tray "next" does nothing then.
    if (!visible) return;
    // While asleep the rig treats this as a userBack (wake, then wave); otherwise it is nothing.
    sleeping = false;
    emit('nextNow');
    advance(true);
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
    if (sleeping) { endPause(); wake(); }
    nextNow();
  }
  /** Ends a menu or tray pause; in quiet hours she also stays awake until that quiet window ends. */
  function endPause() {
    if (progress.pausedUntil) { progress.pausedUntil = 0; saveProgress('pausedUntil'); }
    const now = new Date();
    if (settings.quietEnabled && inQuietWindow(now, settings.quietFrom, settings.quietTo)) quietSkippedUntil = quietWindowEnd(now, settings.quietTo);
  }
  function onSpriteEnter() {
    emit('hoverEnter');
  }

  // ------------------------------------------------------------------ menu actions
  let menuHeight = $state(0);
  /** Beside her chest, but never past the window's top: at sizes Vừa and Lớn a 250 px window cut the menu off. */
  const menuBottom = $derived(Math.max(
    SHADOW_PAD,
    // Its top edge stays clear of the bubble's top edge (24px lower), so the two outlines never merge.
    Math.min(settings.petCharacter ? spriteCss.h * 0.45 : 6, winCss.h - menuHeight - (slotInset.top + 24)),
  ));

  async function pauseFor(minutes: number) {
    menuOpen = false;
    if (!minutes) {
      endPause();
      wake();
      nextNow();
      return;
    }
    // Pausing again also ends a "Tiếp tục" given during quiet hours.
    quietSkippedUntil = 0;
    progress.pausedUntil = Date.now() + minutes * 60_000;
    goSleep('quietHours');
    await saveProgress('pausedUntil');
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
    } else {
      if (shown) {
        shown = false;
        hiddenBefore = true;
        closeBubble();
        win.hide();
        emit('fullscreenHide');
      }
      // Hidden by a fullscreen app (also one open at start-up) the loop only polls until it closes;
      // switched off, the loop stops at once.
      scheduleTick(5_000);
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
  // One resize at a time, each reading the window as the previous one left it; click-through rects are
  // reported once the window has its new size.
  let resizing = Promise.resolve();
  $effect(() => {
    const key = `${winCss.w}x${winCss.h}`;
    if (!ready || key === lastWin) return;
    lastWin = key;
    resizing = resizing.then(resizeKeepingCorner).then(reportHitRects, (e) => console.error('pet resize', e));
  });

  onMount(() => {
    const unlisten: Promise<() => void>[] = [];
    (async () => {
      await initProgress();
      applyTheme();
      // A fullscreen app already open at start-up: its system:busy event may have gone out before we listened.
      const sys = await ipc.systemState().catch(() => null);
      if (sys) busy = sys.busy;
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
        <button class="nap glass-solid glass-press glass-arc" onclick={() => ipc.openMain('/topics')}><Icon name="bell" /> Chưa bật chủ đề nào, bấm để chọn chủ đề</button>
      {:else}
        <button class="nap glass-solid glass-press glass-arc" onclick={resume}><Icon name="pet-sleep" /> Đang tạm dừng, bấm để tiếp tục</button>
      {/if}
    </div>
  {/if}

  {#if menuOpen}
    <div
      class="menu glass-solid glass-arc"
      bind:this={menuEl}
      onanimationend={reportHitRects}
      role="menu"
      tabindex="-1"
      style:left={anchor.h === 'left' ? `${settings.petCharacter ? spriteCss.w * 0.7 : 6}px` : null}
      style:right={anchor.h === 'right' ? `${settings.petCharacter ? spriteCss.w * 0.7 : 6}px` : null}
      style:bottom="{menuBottom}px"
      bind:offsetHeight={menuHeight}
    >
      <button role="menuitem" onclick={() => { menuOpen = false; nextNow(); }}><Icon name="pet-next" /> Từ tiếp theo</button>
      {#if paused()}
        <button role="menuitem" onclick={() => pauseFor(0)}><Icon name="play" /> Tiếp tục</button>
      {:else}
        <button role="menuitem" onclick={() => pauseFor(30)}><Icon name="pet-sleep" /> Tạm dừng 30 phút</button>
      {/if}
      <button role="menuitem" onclick={() => { menuOpen = false; ipc.openMain(); }}><Icon name="pet-open" /> Mở Tiểu Mai</button>
      <button role="menuitem" onclick={toggleCharacter}><Icon name={settings.petCharacter ? 'pet-hide-character' : 'pet-show-character'} /> {settings.petCharacter ? 'Ẩn trợ lý' : 'Hiện trợ lý'}</button>
      <button role="menuitem" onclick={hidePet}><Icon name="pet-hide" /> Ẩn bảng gợi ý</button>
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
    {#if ready}<Rig bind:this={rig} scale={spriteScale} {mirror} hidden={!visible} onready={() => { drawing = true; resendHeldState(); }} onrestart={resendHeldState} onlost={() => (drawing = false)} />{/if}
    {#if sleeping}<span class="zzz" aria-hidden="true">z<small>z</small></span>{/if}
  </div>
  {/if}
</div>

<HoverPinyin dictionaryOnly />

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
    /* Primary in the pet fills (bubble, nap pill, menu): on a plain white fill the white top rim cannot show. */
    /* A white highlight can only rise as far as the fill is below white: at 6 % the fill sat at 245 levels and the top
       rim at +10. At 15 % it sits near 234 and the rim reaches about +20 (measure-pet.mjs). */
    --pet-tint: 15%;
    /* Light pet surfaces: a faint dark lower-right line (it must not outweigh the lit top) and a soft white glow along
       the top. */
    --pet-glow: .9;
    --glass-rim-dark: 5%;
    --glass-rim-side: 4%;
  }
  /* Hoa anh đào's pink is so light that 15 % barely lowers the fill: it needs more for the same headroom. */
  :global(:root[data-theme-id='sakura'][data-theme='light']) .stage { --pet-tint: 20%; }
  :global(:root[data-theme='dark']) .stage { --pet-tint: 6%; --pet-glow: .1; --glass-rim-dark: 60%; --glass-rim-side: 40%; }
  .sprite-slot:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 12px; }
  .sprite-slot {
    position: absolute;
    cursor: grab;
    outline: none;
  }
  .bubble-slot {
    position: absolute;
  }
  .nap {
    border: 0;
    /* No wider than the bubble, so it stays inside the window; a wrapped label balances its two lines. */
    max-width: 264px;
    white-space: normal;
    text-wrap: balance;
    line-height: 1.3;
    border-radius: var(--radius);
    /* The bubble's tinted fill: on plain white the white rim cannot show. */
    --glass-tint: color-mix(in srgb, var(--primary) var(--pet-tint), var(--bubble-bg));
    color: var(--bubble-text);
    --glass-rim-w: 3px;
    --glass-rim-top: 4px;
    box-shadow: inset 0 0 0 2px var(--bubble-border), var(--glass-rim), inset 0 8px 10px -8px rgb(var(--glass-white) / var(--pet-glow)), var(--pet-shadow);
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
  }
  /* Hover stays opaque (the shared hover thins the fill, which reads as nothing on a plain desktop): a denser tint and a
     deeper lit top edge. */
  .nap:hover:not(:disabled) { --glass-alpha: 100%; --glass-rim-top: 5px; --glass-tint: color-mix(in srgb, var(--primary) calc(var(--pet-tint) + 10%), var(--bubble-bg)); }
  /* The pet focus colour, inside the pill's own ring: outside it would sit on the bare desktop. */
  .nap:focus-visible { outline: 2px solid var(--primary); outline-offset: -6px; }
  .menu {
    position: absolute;
    display: flex;
    flex-direction: column;
    min-width: 168px;
    padding: 6px;
    /* Opaque: the window has no backdrop filter, so a translucent menu would show the bubble's text through it. */
    --glass-alpha: 100%;
    --glass-tint: color-mix(in srgb, var(--primary) var(--pet-tint), var(--bubble-bg));
    z-index: 2;
    border-radius: 14px;
    --glass-rim-w: 3px;
    --glass-rim-top: 4px;
    box-shadow: inset 0 0 0 2px var(--bubble-border), var(--glass-rim), inset 0 8px 10px -8px rgb(var(--glass-white) / var(--pet-glow)), var(--pet-shadow);
    animation: pop 0.16s ease-out;
  }
  /* The specular arc (glass-arc, dark themes) inside the 2px ring. */
  .nap, .menu { --arc-inset: 2px; --arc-tint: var(--bubble-border); }
  .nap { --arc-r: var(--radius); }
  .menu { --arc-r: 14px; }
  /* Press: the shared sunk look, still opaque. */
  .nap:active:not(:disabled) { --glass-rim-hi: var(--rim-press); --glass-rim-mid: var(--rim-press-mid); --glass-rim-top: var(--glass-rim-w); box-shadow: inset 0 0 0 2px var(--bubble-border), var(--glass-rim), inset 0 2px 5px rgb(var(--glass-black) / .22), var(--pet-shadow); }
  /* Dark: the hover's denser primary tint is lighter than the rest face; back to it, with the pills' sunk shadow and wash. */
  :global(:root[data-theme='dark']) .nap:active:not(:disabled) { --glass-tint: color-mix(in srgb, var(--primary) var(--pet-tint), var(--bubble-bg));
    box-shadow: inset 0 0 0 2px var(--bubble-border), var(--glass-rim), inset 0 2px 7px color-mix(in srgb, var(--bg) 65%, transparent), inset 0 0 0 100vmax rgb(var(--glass-black) / .2), var(--pet-shadow); }
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
  /* A primary tint with a white top line in light, a text-coloured fill in dark: about 20 levels off the menu fill either way. */
  .menu button:hover { background: color-mix(in srgb, var(--primary) 14%, transparent); box-shadow: inset 0 1px 0 rgb(var(--glass-white) / .8); }
  :global(:root[data-theme='dark']) .menu button:hover { background: color-mix(in srgb, var(--text) 12%, transparent); box-shadow: none; }
  .menu button:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
  @keyframes pop { from { transform: scale(0.85); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .menu { animation: none; } }
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
