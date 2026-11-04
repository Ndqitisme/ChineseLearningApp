import { mount } from 'svelte';
import '../lib/ui/base.css';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });
