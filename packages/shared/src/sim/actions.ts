/**
 * 이동·휘두르기 밖의 플레이어 행동: 짓기, 버리기, 줍기.
 *
 * 전부 서버에서만 실행되고, 전부 여기서 검증된다. 클라는 "하고 싶다"만 보낸다.
 *
 * 무기를 "만드는" 행동은 없다. 무기는 땅에서 나온다(sim/damage.ts의 rollTileLoot).
 * 여기 남은 건 그걸 줍고 버리는 일뿐이고, 손이 하나라서 그 둘이 곧 전략이 된다.
 */
import { BUILDING, PLAYER, TILE } from '../config/balance.js';
import { STRUCTURES, type StructureId } from '../buildings.js';
import { dist2, inBounds, tileCenter, tileIndex, toTileX, toTileY } from '../math.js';
import { Tile } from '../tiles.js';
import { weaponDef } from '../weapons.js';
import type { Player, World } from '../types.js';
import { getTile, setTile } from './world.js';
import { dropWeapon } from './damage.js';

export type PlayerAction =
  | { type: 'build'; tx: number; ty: number; structure: StructureId }
  | { type: 'drop' }
  | { type: 'pickup' };

export interface ActionResult { ok: boolean; reason?: string }
const fail = (reason: string): ActionResult => ({ ok: false, reason });
const OK: ActionResult = { ok: true };

// ── 건설 ─────────────────────────────────────────────────────────────────────

export const canBuildAt = (w: World, p: Player, tx: number, ty: number): ActionResult => {
  if (!inBounds(tx, ty)) return fail('맵 밖');
  if (getTile(w, tx, ty) !== Tile.EMPTY) return fail('빈 칸이 아님');
  const cx = tileCenter(tx), cy = tileCenter(ty);
  if (dist2(p.x, p.y, cx, cy) > BUILDING.range ** 2) return fail('너무 멈');
  // 누군가 서 있는 칸에는 못 짓는다. 벽으로 사람을 가두는 짓을 막는다.
  for (const other of w.players.values()) {
    if (!other.alive) continue;
    const half = TILE / 2 + PLAYER.radius;
    if (Math.abs(other.x - cx) < half && Math.abs(other.y - cy) < half) return fail('누가 서 있음');
  }
  return OK;
};

export const build = (
  w: World, p: Player, tx: number, ty: number, type: StructureId,
): ActionResult => {
  if (!p.alive) return fail('죽어 있음');
  const def = p.weapon ? weaponDef(p.weapon) : null;
  if (!def || def.buildPower <= 0) return fail('망치가 없음');

  const placeable = canBuildAt(w, p, tx, ty);
  if (!placeable.ok) return placeable;

  const sdef = STRUCTURES[type];
  if (p.res.ore < sdef.cost.ore || p.res.shard < sdef.cost.shard) return fail('자원 부족');

  p.res.ore -= sdef.cost.ore;
  p.res.shard -= sdef.cost.shard;

  const idx = tileIndex(tx, ty);
  setTile(w, tx, ty, Tile.STRUCTURE);
  w.tileHp[idx] = sdef.hp;
  w.structures.set(idx, {
    tile: idx, type, team: p.team, owner: p.id,
    hp: sdef.hp, maxHp: sdef.hp,
    nextActTick: w.tick + sdef.intervalTicks,
  });
  p.readyTick = w.tick + BUILDING.placeTicks;
  w.events.push({ t: 'build', tile: idx, type, team: p.team });
  return OK;
};

// ── 버리기 / 줍기 ────────────────────────────────────────────────────────────

export const dropHeld = (w: World, p: Player): ActionResult => {
  if (!p.alive || !p.weapon) return fail('버릴 게 없음');
  dropWeapon(w, p.x, p.y, p.weapon);
  p.weapon = null;
  p.swingHitTick = 0;
  return OK;
};

/** 가장 가까운 무기 드롭을 집는다. 들고 있던 것은 그 자리에 떨어진다. */
export const pickup = (w: World, p: Player): ActionResult => {
  if (!p.alive) return fail('죽어 있음');
  let best = -1;
  let bestD = (PLAYER.pickupRadius * 1.6) ** 2;
  for (let i = 0; i < w.drops.length; i++) {
    const d = w.drops[i];
    if (d.kind !== 'weapon' || w.tick < d.pickupTick) continue;
    const dd = dist2(p.x, p.y, d.x, d.y);
    if (dd < bestD) { bestD = dd; best = i; }
  }
  if (best < 0) return fail('주울 게 없음');

  const drop = w.drops[best];
  w.drops.splice(best, 1);
  if (p.weapon) dropWeapon(w, p.x, p.y, p.weapon);
  p.weapon = drop.weapon;
  p.swingHitTick = 0;
  p.readyTick = w.tick + 4;
  w.events.push({ t: 'pickup', id: p.id, kind: 'weapon', weapon: drop.weapon, amount: 1 });
  return OK;
};

/** 자원 드롭은 가까이 가면 알아서 들어온다. 전투 중에 줍기 버튼을 누를 여유는 없다. */
export const autoCollect = (w: World, p: Player): void => {
  if (!p.alive) return;
  const r2 = PLAYER.pickupRadius ** 2;
  for (let i = w.drops.length - 1; i >= 0; i--) {
    const d = w.drops[i];
    if (d.kind === 'weapon' || w.tick < d.pickupTick) continue;
    if (dist2(p.x, p.y, d.x, d.y) > r2) continue;

    if (d.kind === 'health') {
      // 가득 차 있으면 그냥 지나간다. 다치고 나서 되돌아올 수 있도록 남겨 둔다.
      if (p.hp >= PLAYER.maxHp) continue;
      const healed = Math.min(d.amount, PLAYER.maxHp - p.hp);
      p.hp += healed;
      w.events.push({ t: 'heal', id: p.id, amount: healed, x: p.x, y: p.y });
    } else if (d.kind === 'ore') {
      p.res.ore += d.amount;
    } else {
      p.res.shard += d.amount;
    }

    w.events.push({ t: 'pickup', id: p.id, kind: d.kind, weapon: null, amount: d.amount });
    w.drops.splice(i, 1);
  }
};

export const applyAction = (w: World, p: Player, a: PlayerAction): ActionResult => {
  switch (a.type) {
    case 'build': return build(w, p, a.tx, a.ty, a.structure);
    case 'drop': return dropHeld(w, p);
    case 'pickup': return pickup(w, p);
  }
};

/** 클라가 마우스로 가리킨 지점 → 건설 대상 칸. 서버·클라가 같은 규칙을 써야 미리보기가 맞는다. */
export const buildTargetTile = (p: Player): { tx: number; ty: number } => {
  const x = p.x + Math.cos(p.aim) * TILE * 1.6;
  const y = p.y + Math.sin(p.aim) * TILE * 1.6;
  return { tx: toTileX(x), ty: toTileY(y) };
};
