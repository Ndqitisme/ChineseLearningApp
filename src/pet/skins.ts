import type { Component } from 'svelte';
import MeadowFrame from './frames/MeadowFrame.svelte';
import { MEADOW, type FrameProps, type Pad } from './frames/meadow.ts';
import { SHADOW_PAD } from './geometry.ts';

/** Looks for the hint panel. `frame` draws a border around the word bubble; a skin without one shows the character.
 * `pad` widens the window margin around the bubble for a border that needs more room than the shadow. */
export const PET_SKINS = [
  { id: 'assistant', label: 'Trợ lý' },
  { id: 'leaf', label: 'Viền hoa lá', frame: MeadowFrame, pad: MEADOW.pad },
] as const satisfies readonly { id: string; label: string; frame?: Component<FrameProps>; pad?: Pad }[];

export type PetSkin = (typeof PET_SKINS)[number]['id'];

export const skinFrame = (id: PetSkin): Component<FrameProps> | undefined => {
  const s = PET_SKINS.find((k) => k.id === id);
  return s && 'frame' in s ? s.frame : undefined;
};

/** The plain bubble's margin: room for its shadow on every side. */
export const PLAIN_PAD: Pad = { top: SHADOW_PAD, side: SHADOW_PAD, bottom: SHADOW_PAD };

/** Window margin around the bubble when it is shown without the character. */
export const skinPad = (id: PetSkin | undefined): Pad => {
  const s = id && PET_SKINS.find((k) => k.id === id);
  return s && 'pad' in s ? s.pad : PLAIN_PAD;
};
