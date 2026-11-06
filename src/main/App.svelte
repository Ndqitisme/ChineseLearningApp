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
  import { applyTheme } from '../lib/theme/apply.svelte.ts';
  import HoverPinyin from '../lib/ui/HoverPinyin.svelte';
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
  import { reviewQueueIds } from './review-queue.ts';

  let ready = $state(false);
  let avatar = $state<ReturnType<typeof Rig>>();

  const dueCount = $derived(reviewQueueIds().length);

  const NAV: { path: string; name: string; icon: IconName; label: string }[] = [
    { path: '/', name: 'home', icon: 'nav-home', label: 'Trang chủ' },
    { path: '/topics', name: 'topics', icon: 'nav-topics', label: 'Chủ đề' },
    { path: '/practice', name: 'practice', icon: 'nav-practice', label: 'Luyện tập' },
    { path: '/review', name: 'review', icon: 'nav-review', label: 'Ôn tập' },
    { path: '/search', name: 'search', icon: 'nav-search', label: 'Tra cứu' },
    { path: '/notebook', name: 'notebook', icon: 'nav-notebook', label: 'Sổ tay' },
    { path: '/settings', name: 'settings', icon: 'nav-settings', label: 'Cài đặt' },
    { path: '/about', name: 'about', icon: 'nav-about', label: 'Giới thiệu' },
    { path: '/support', name: 'support', icon: 'nav-support', label: 'Ủng hộ tác giả' },
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
    (async () => {
      await initProgress();
      applyTheme();
      ready = true;
      await getCurrentWindow().show();
    })();
    return () => { unlisten.then((f) => f()); };
  });
</script>

<div class="shell">
  <TitleBar />
  {#if ready}
    <div class="body">
      <nav class="side">
        <button class="me" onclick={() => avatar?.emit('known')} aria-label="Tiểu Mai">
          <div class="avatar"><Rig bind:this={avatar} scale={170 / FRAME.h} onready={() => avatar?.emit('appStart')} /></div>
        </button>
        {#each NAV as item (item.path)}
          <a href="#{item.path}" class:on={active === item.name}>
            <span class="ic"><Icon name={item.icon} /></span>{item.label}
            {#if item.name === 'review' && dueCount}<span class="badge">{dueCount}</span>{/if}
          </a>
        {/each}
        <div class="spacer"></div>
        <label class="pet-toggle">
          <input type="checkbox" checked={settings.petEnabled} onchange={(e) => updateSettings({ petEnabled: e.currentTarget.checked })} />
          Trợ lý trên màn hình
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
  .side {
    width: 206px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 12px 12px 14px;
    background: var(--bg-2);
    border-right: 1.5px solid var(--border);
  }
  .me {
    border: 0;
    background: var(--surface);
    border-radius: var(--radius);
    margin-bottom: 10px;
    padding: 4px 0 0;
    display: flex;
    justify-content: center;
    box-shadow: var(--shadow);
  }
  /* Head-and-shoulders crop of the full-body rig. */
  .avatar { height: 92px; overflow: hidden; }
  .side a {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    border-radius: 12px;
    color: var(--text);
    text-decoration: none;
    font-weight: 800;
    font-size: 14.5px;
  }
  .side a:hover { background: var(--surface-2); }
  .side a.on { background: var(--primary); color: var(--on-primary); }
  .ic { width: 22px; text-align: center; }
  .badge {
    margin-left: auto;
    background: var(--bad);
    color: #fff;
    border-radius: 99px;
    font-size: 11px;
    padding: 1px 7px;
  }
  .pet-toggle { display: flex; gap: 8px; align-items: center; font-size: 12.5px; font-weight: 700; color: var(--text-2); padding: 0 6px; }
  .content {
    flex: 1;
    overflow-y: auto;
    background: var(--pattern), var(--bg);
  }
</style>
