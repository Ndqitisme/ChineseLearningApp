import { mount } from 'svelte';
import { initSettings, loadOpenLevels } from '../lib/settings.svelte.ts';
import '../lib/ui/base.css';
import App from './App.svelte';

// Pages read settings and the open HSK packs synchronously, so both are ready before mount.
await initSettings();
await loadOpenLevels();
mount(App, { target: document.getElementById('app')! });
