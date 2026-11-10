import type { Component } from 'svelte';
import BambooFrame from './frames/BambooFrame.svelte';
import LeafFrame from './frames/LeafFrame.svelte';

/** Looks for the hint panel. `frame` draws a border around the word bubble; a skin without one shows the character. */
export const PET_SKINS = [
  { id: 'assistant', label: 'Trợ lý' },
  { id: 'leaf', label: 'Viền cỏ lá', frame: LeafFrame },
  { id: 'bamboo', label: 'Viền trúc', frame: BambooFrame },
] as const satisfies readonly { id: string; label: string; frame?: Component }[];

export type PetSkin = (typeof PET_SKINS)[number]['id'];

export const skinFrame = (id: PetSkin): Component | undefined => {
  const s = PET_SKINS.find((k) => k.id === id);
  return s && 'frame' in s ? s.frame : undefined;
};
