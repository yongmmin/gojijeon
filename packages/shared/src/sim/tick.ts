/**
 * 서버 틱 하나.
 *
 * 순수 함수는 아니지만(World를 제자리에서 고친다) 외부 의존은 전혀 없다.
 * 소켓도, 렌더도, 시간도 모른다. 그래서 테스트에서 수천 틱을 돌려볼 수 있다.
 */
import { Button, Phase, type World } from '../types.js';
import type { GameMode } from '../modes/index.js';
import { applyMovement } from './movement.js';
import { beginSwing, resolveSwing, updateProjectiles } from './combat.js';
import { autoCollect, dropHeld, pickup } from './actions.js';
import { updateStructures } from './structures.js';
import { updateMatch } from './match.js';
import { updateOutpost } from './outpost.js';
import { updateZone } from './zone.js';

const pressed = (now: number, before: number, mask: number): boolean =>
  (now & mask) !== 0 && (before & mask) === 0;

export const stepWorld = (w: World, mode: GameMode): void => {
  w.tick += 1;
  w.events.length = 0;
  w.dirtyTiles.clear();

  const live = w.phase === Phase.PREP || w.phase === Phase.COMBAT;

  for (const p of w.players.values()) {
    const buttons = p.input.buttons;

    if (p.alive && live) {
      applyMovement(w, p);

      if (pressed(buttons, p.lastButtons, Button.DROP)) dropHeld(w, p);
      if (pressed(buttons, p.lastButtons, Button.INTERACT)) pickup(w, p);

      // PRIMARY는 누르고 있으면 계속 나간다. 채굴이 연타가 되면 손이 아프다.
      if ((buttons & Button.PRIMARY) !== 0) beginSwing(w, p);
      else if (p.swingHitTick === 0) p.miningTile = -1;

      if (p.swingHitTick > 0 && w.tick >= p.swingHitTick) resolveSwing(w, p);

      autoCollect(w, p);
    } else {
      p.vx = 0;
      p.vy = 0;
      p.aim = p.input.aim;
    }

    p.lastButtons = buttons;
  }

  if (live) {
    updateProjectiles(w);
    updateStructures(w);
    updateOutpost(w);
    updateZone(w);
    mode.onTick?.(w);
  }

  for (let i = w.drops.length - 1; i >= 0; i--) {
    if (w.tick >= w.drops[i].dieTick) w.drops.splice(i, 1);
  }

  updateMatch(w, mode);
};
