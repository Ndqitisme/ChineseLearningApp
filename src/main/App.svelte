<script lang="ts">
  import Icon from '../lib/ui/Icon.svelte';
  import type { IconName } from '../lib/ui/icon-names.ts';
  import { onMount } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { EVENTS } from '../lib/ipc.ts';
  import { initProgress } from '../lib/progress.svelte.ts';
  import { settings, updateSettings } from '../lib/settings.svelte.ts';
  import Rig from '../lib/rig/Rig.svelte';
  import { FRAME } from '../lib/rig/load.ts';
  import { applyTheme, theme } from '../lib/theme/apply.svelte.ts';
  import { HUE_OF, hueVar, type Hue } from '../lib/theme/themes.ts';
  import HoverPinyin from '../lib/ui/HoverPinyin.svelte';
  import Switch from '../lib/ui/Switch.svelte';
  import { glass, LIGHT_SPECULAR } from '../lib/ui/glass/glass.ts';
  import TitleBar from './components/TitleBar.svelte';
  import { go, route } from './router.svelte.ts';
  import About from './pages/About.svelte';
  import Home from './pages/Home.svelte';
  import Notebook from './pages/Notebook.svelte';
  import Practice from './pages/Practice.svelte';
  import Quiz from './pages/Quiz.svelte';
  import Review from './pages/Review.svelte';
  import Search from './pages/Search.svelte';
  import Settings from './pages/Settings.svelte';
  import Support from './pages/Support.svelte';
  import Tones from './pages/Tones.svelte';
  import TopicPage from './pages/Topic.svelte';
  import Topics from './pages/Topics.svelte';
  import WordPage from './pages/Word.svelte';
  import Write from './pages/Write.svelte';
  import Build from './pages/Build.svelte';
  import './app.css';
  import { reviewQueueIds, startClock } from './review-queue.svelte.ts';

  let ready = $state(false);
  let avatar = $state<ReturnType<typeof Rig>>();
  // She waves once when the window opens; the rig also reports ready after a rebuild for another pixel ratio.
  let waved = false;
  const greet = () => { if (!waved) { waved = true; avatar?.emit('appStart'); } };

  const dueCount = $derived(reviewQueueIds().length);

  /** Settings has no hue: it is not a place to learn, and nine items would repeat one of the eight hues. */
  const NAV: { path: string; name: string; icon: IconName; hue?: Hue; label: string }[] = [
    { path: '/', name: 'home', icon: 'nav-home', hue: HUE_OF.home, label: 'Trang chủ' },
    { path: '/topics', name: 'topics', icon: 'nav-topics', hue: HUE_OF.topics, label: 'Chủ đề' },
    { path: '/practice', name: 'practice', icon: 'nav-practice', hue: HUE_OF.practice, label: 'Luyện tập' },
    { path: '/review', name: 'review', icon: 'nav-review', hue: HUE_OF.review, label: 'Ôn tập' },
    { path: '/search', name: 'search', icon: 'nav-search', hue: HUE_OF.search, label: 'Tra cứu' },
    { path: '/notebook', name: 'notebook', icon: 'nav-notebook', hue: HUE_OF.notebook, label: 'Sổ tay' },
    { path: '/settings', name: 'settings', icon: 'nav-settings', label: 'Cài đặt' },
    { path: '/about', name: 'about', icon: 'nav-about', hue: HUE_OF.about, label: 'Giới thiệu' },
    { path: '/support', name: 'support', icon: 'nav-support', hue: HUE_OF.support, label: 'Ủng hộ tác giả' },
  ];
  const ACTIVE: Record<string, string> = { topic: 'topics', hsk: 'topics', word: 'search', quiz: 'practice', write: 'practice', tones: 'practice', build: 'practice' };
  const active = $derived(ACTIVE[route.name] ?? route.name);
  let content = $state<HTMLElement>();
  // The scroll box outlives the page: reset it before the new page mounts, so a page that
  // scrolls itself (Settings → section) still wins.
  $effect.pre(() => {
    void route.path;
    if (content) content.scrollTop = 0;
  });

  onMount(() => {
    const unlisten = listen<string>(EVENTS.navigate, ({ payload }) => go(payload));
    const stopClock = startClock();
    (async () => {
      await initProgress();
      applyTheme();
      ready = true;
      await getCurrentWindow().show();
    })();
    return () => { unlisten.then((f) => f()); stopClock(); };
  });
</script>

<div class="shell">
  <TitleBar />
  {#if ready}
    <div class="body">
      <nav class="side glass" use:glass={{ specular: theme.dark ? 0.3 : LIGHT_SPECULAR }}>
        <button class="me glass-soft glass-press" onclick={() => avatar?.emit('known')} aria-label="Tiểu Mai">
          <div class="avatar"><Rig bind:this={avatar} scale={170 / FRAME.h} onready={greet} /></div>
        </button>
        {#each NAV as item (item.path)}
          <a href="#{item.path}" class="glass-row" class:on={active === item.name}>
            <span class="ic" style:--h={item.hue ? hueVar(item.hue) : null}><Icon name={item.icon} /></span>{item.label}
            {#if item.name === 'review' && dueCount}<span class="badge">{dueCount}</span>{/if}
          </a>
        {/each}
        <div class="spacer"></div>
        <label class="pet-toggle">
          <Switch checked={settings.petEnabled} onchange={(on) => updateSettings({ petEnabled: on })} />
          Bảng gợi ý
        </label>
        <!-- The skin lives on the panel: without the panel the switch is disabled and keeps its value. -->
        <label class="pet-toggle" class:off={!settings.petEnabled}>
          <Switch checked={settings.petSkinOn} disabled={!settings.petEnabled} onchange={(on) => updateSettings({ petSkinOn: on })} />
          Skin
        </label>
      </nav>
      <main class="content" bind:this={content}>
        {#key route.path}
          {#if route.name === 'home'}<Home />
          {:else if route.name === 'topics'}<Topics />
          {:else if route.name === 'topic' || route.name === 'hsk'}<TopicPage kind={route.name} id={route.params[0]} />
          {:else if route.name === 'word'}<WordPage id={route.params[0]} />
          {:else if route.name === 'practice'}<Practice />
          {:else if route.name === 'quiz'}<Quiz params={route.params} />
          {:else if route.name === 'review'}<Review />
          {:else if route.name === 'write'}<Write params={route.params} />
          {:else if route.name === 'build'}<Build params={route.params} />
          {:else if route.name === 'tones'}<Tones params={route.params} />
          {:else if route.name === 'search'}<Search query={route.params[0] ?? ''} />
          {:else if route.name === 'notebook'}<Notebook />
          {:else if route.name === 'settings'}<Settings section={route.params[0]} />
          {:else if route.name === 'about'}<About />
          {:else if route.name === 'support'}<Support />
          {:else}<Home />{/if}
        {/key}
      </main>
    </div>
    <HoverPinyin />
  {/if}
</div>

<style>
  .shell { height: 100%; display: flex; flex-direction: column; }
  .body { flex: 1; display: flex; min-height: 0; }
  /* A floating glass slab: its margin keeps the rim off the window edge. */
  .side {
    width: 196px;
    flex: none;
    display: flex;
    flex-direction: column;
    /* Room for the hovered item's 1px lift next to the active pill. */
    gap: 5px;
    margin: 10px 0 10px 10px;
    padding: 10px 10px 12px;
    border-radius: var(--radius);
    --glass-tint: var(--bg-2);
    --glass-alpha: 36%;
    --nested-r: max(4px, calc(var(--radius) - 10px));
  }
  .me {
    border: 0;
    /* Concentric with the sidebar's corner: its radius minus the 10px padding. */
    border-radius: var(--nested-r);
    margin-bottom: 10px;
    padding: 4px 0 0;
    display: flex;
    justify-content: center;
    --glass-alpha: 55%;
  }
  /* The plain pills' hover tint: in dark themes the denser surface matched the sidebar it sits on. */
  .me:hover:not(:active) { --glass-tint: color-mix(in srgb, var(--primary) 14%, var(--surface)); }
  /* Head-and-shoulders crop of the full-body rig. */
  .avatar { height: 92px; overflow: hidden; }
  .side a {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    /* The portrait card's radius: the nav rows sit at the same 10px inset. */
    border-radius: var(--nested-r);
    color: var(--text);
    text-decoration: none;
    font-weight: 800;
    font-size: 14.5px;
    transition: background .12s ease, transform .12s ease, box-shadow .12s ease;
  }
  /* At the smallest window height the two switches must still fit inside the slab. */
  @media (max-height: 660px) { .side a { padding-block: 7px; } }
  /* Hover: a thin glass slab with the directional rim (lit top-left, dark bottom-right), a contact shadow and a 1px lift. */
  :where(.side) a:hover {
    transform: translateY(-1px);
    box-shadow: inset 0 2px 0 rgb(var(--glass-white) / var(--glass-rim-hi)), inset 1px 0 0 rgb(var(--glass-white) / var(--glass-rim-mid)),
      inset 0 -1px 0 color-mix(in srgb, var(--glass-rim-end) var(--glass-rim-dark), transparent),
      inset -1px 0 0 color-mix(in srgb, var(--glass-rim-end) var(--glass-rim-side), transparent),
      0 1px 2px rgb(var(--glass-black) / .1), 0 2px 6px rgb(var(--glass-black) / .06);
  }
  /* The same rim and top sheen as the primary pills. */
  .side a.on {
    background: linear-gradient(to bottom, rgb(var(--glass-white) / .16), transparent 7px), var(--primary);
    color: var(--on-primary);
    box-shadow: inset 0 1px 0 rgb(var(--glass-white) / .45), inset 0 -1px 0 rgb(var(--glass-black) / .16), inset 1px 0 0 rgb(var(--glass-white) / .22), inset -1px 0 0 rgb(var(--glass-black) / .1), 0 2px 8px color-mix(in srgb, var(--primary) 35%, transparent);
  }
  /* Light: the sidebar is itself blue-tinted glass; 16 % primary moved the row 2 levels there, 24 % about 15. */
  :global(:root[data-theme='light']) .side a:not(.on):hover { background: color-mix(in srgb, color-mix(in srgb, var(--primary) 24%, var(--surface)) 85%, transparent); }
  .side a.on:hover { background: linear-gradient(to bottom, rgb(var(--glass-white) / .16), transparent 7px), var(--primary-2); }
  .ic { width: 22px; text-align: center; color: var(--h, var(--text-2)); }
  .side a.on .ic { color: inherit; }
  /* On the filled current item the inset ring takes the label's colour, with a pixel of the fill outside it: the ink
     colour on the primary fill was a colour swap of under 3:1. */
  .side a.on:focus-visible { outline-color: var(--on-primary); outline-offset: -3px; }
  .badge {
    margin-left: auto;
    /* --bad pulled toward the text colour: the surface-coloured count stays at 4.5:1 in both looks. */
    background: color-mix(in srgb, var(--bad) 85%, var(--text));
    color: var(--surface);
    border-radius: 99px;
    font-size: 11px;
    padding: 1px 7px;
    box-shadow: inset 0 1px 0 rgb(var(--glass-white) / .35);
  }
  /* A row like the nav rows above: the label starts on their icon column and the track ends at their right padding. */
  .pet-toggle { --switch-w: 34px; display: flex; flex-direction: row-reverse; justify-content: space-between; gap: 10px; align-items: center; font-size: 12.5px; font-weight: 700; color: color-mix(in srgb, var(--text-2) 70%, var(--text)); padding: 0 12px; cursor: pointer; transition: color .2s ease; }
  .pet-toggle + .pet-toggle { margin-top: 6px; }
  .pet-toggle.off { color: var(--text-2); cursor: default; }
  @media (prefers-reduced-motion: reduce) { .pet-toggle { transition: none; } }
  /* A control reached by Tab stops 24px clear of the window edge, its focus ring included. */
  .content {
    flex: 1;
    overflow-y: auto;
    scroll-padding-block: 24px;
  }
  @media (prefers-reduced-motion: reduce) { .side a { transition: none; } .side a:hover { transform: none; } }
  @media (prefers-reduced-transparency: reduce) {
    .side a:hover { background: var(--surface-2); }
    .side a.on { background: var(--primary); box-shadow: none; }
  }
</style>
