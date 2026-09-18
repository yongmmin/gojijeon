/** 주기적으로 동작하는 건물: 화톳불(회복)과 포탑(자동 사격). */
import { PLAYER, secs } from '../config/balance.js';
import { structureDef } from '../buildings.js';
import { dist2, tileCenter, tileXOf, tileYOf } from '../math.js';
import type { World } from '../types.js';
import { losClear, spawnBolt } from './combat.js';

export const updateStructures = (w: World): void => {
  for (const s of w.structures.values()) {
    const def = structureDef(s.type);
    if (def.intervalTicks <= 0 || w.tick < s.nextActTick) continue;
    s.nextActTick = w.tick + def.intervalTicks;

    const sx = tileCenter(tileXOf(s.tile));
    const sy = tileCenter(tileYOf(s.tile));

    if (def.heal) {
      const r2 = def.heal.radius ** 2;
      for (const p of w.players.values()) {
        if (!p.alive || p.team !== s.team) continue;
        if (dist2(p.x, p.y, sx, sy) > r2) continue;
        p.hp = Math.min(PLAYER.maxHp, p.hp + def.heal.amount);
      }
    }

    if (def.turret) {
      // 가장 가까운 적 하나. 벽 너머는 조준하지 않는다 — 안 그러면 포탑이
      // 제 팀 벽에 대고 쏘면서 사거리만큼 강해진다.
      let bestA = 0;
      let bestD = def.turret.range ** 2;
      let found = false;
      for (const p of w.players.values()) {
        if (!p.alive || p.team === s.team) continue;
        const d = dist2(p.x, p.y, sx, sy);
        if (d > bestD) continue;
        if (!losClear(w, sx, sy, p.x, p.y)) continue;
        bestD = d;
        bestA = Math.atan2(p.y - sy, p.x - sx);
        found = true;
      }
      if (found) {
        spawnBolt(w, sx, sy, bestA, s.team, def.turret.projectileSpeed, def.turret.damage, secs(1.2));
      }
    }
  }
};
