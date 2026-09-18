import { ModeId } from '../types.js';
import { ffaMode } from './ffa.js';
import { teamMode } from './team.js';
import type { GameMode } from './mode.js';

export const MODES: Readonly<Record<ModeId, GameMode>> = {
  [ModeId.FFA]: ffaMode,
  [ModeId.TEAM]: teamMode,
};

export const getMode = (id: ModeId): GameMode => MODES[id];
export type { GameMode, RoundOutcome } from './mode.js';
export { ffaMode, teamMode };
