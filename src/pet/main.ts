import { mount } from 'svelte';
import { initSettings, loadOpenLevels } from '../lib/settings.svelte.ts';
import '../lib/ui/base.css';
import Pet from './Pet.svelte';

// Pages read settings and the open HSK packs synchronously, so both are ready before mount.
await initSettings();
await loadOpenLevels();
mount(Pet, { target: document.getElementById('app')! });
