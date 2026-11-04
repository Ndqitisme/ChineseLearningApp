import { mount } from 'svelte';
import '../lib/ui/base.css';
import Pet from './Pet.svelte';

mount(Pet, { target: document.getElementById('app')! });
