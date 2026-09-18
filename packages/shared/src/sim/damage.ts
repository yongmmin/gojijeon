/**
 * 피해 적용의 단일 창구.
 *
 * 근접·투사체·폭발·포탑이 전부 여기를 거친다. 방어 판정과 사망 처리가
 * 한 군데에만 있어야 "방패가 어떤 공격에는 안 먹힌다" 같은 버그가 안 생긴다.
 */
import { LOOT, PLAYER, RESOURCE, TILE } from '../config/balance.js';
import { structureDef } from '../buildings.js';
import { angleDelta, inBounds, tileIndex } from '../math.js';
import { Tile, TILES, type TileId } from '../tiles.js';
import { rollWeapon, weaponDef, type WeaponId } from '../weapons.js';
import { Phase, type Core, type Player, type PlayerId, type TeamId, type World } from '../types.js';
import { getTile, setTile, nextId } from './world.js';
import { shove } from './movement.js';

export const coreAt = (w: World, tx: number, ty: number): Core | undefined =>
  w.cores.find((c) => c.tx === tx && c.ty === ty && c.hp > 0);

/** 방패가 이 방향의 공격을 막는가. 정면만 막힌다 — 뒤를 잡히면 방패는 짐이다. */
const blockFactor = (target: Player, fromX: number, fromY: number): number => {
  if (!target.weapon) return 1;
  const block = weaponDef(target.weapon).block;
  if (!block) return 1;
  const toAttacker = Math.atan2(fromY - target.y, fromX - target.x);
  return Math.abs(angleDelta(toAttacker, target.aim)) <= block.halfArc ? 1 - block.reduction : 1;
};

export interface DamageResult {
  applied: number;
  blocked: boolean;
  killed: boolean;
}

export const damagePlayer = (
  w: World, target: Player, amount: number, by: PlayerId,
  fromX: number, fromY: number, knockback: number = PLAYER.knockback,
): DamageResult => {
  // 준비 페이즈에도 사람은 때릴 수 있다.
  //
  // 예전에는 막아 두었다. 그랬더니 플레이테스터가 시작하자마자 휘둘러 보고
  // 아무 일도 안 일어나니 "이 게임엔 공격이 없다"고 결론지었다. 아무 안내 없이
  // 조용히 무시되는 규칙은 규칙이 아니라 버그로 보인다.
  //
  // 막을 이유도 사라졌다. 진입로는 기지에서 중앙으로만 나 있고 기지끼리는
  // 이어져 있지 않아, 준비 시간 안에 상대 기지를 덮치려면 수십 칸을 파야 한다.
  // 지형이 이미 하던 일을 규칙으로 또 할 필요는 없다.
  if (!target.alive || w.tick < target.invulnUntilTick) {
    return { applied: 0, blocked: false, killed: false };
  }
  const factor = blockFactor(target, fromX, fromY);
  const dealt = Math.max(0, Math.round(amount * factor));
  const blocked = factor < 1;

  target.hp -= dealt;
  if (knockback > 0) {
    const a = Math.atan2(target.y - fromY, target.x - fromX);
    shove(w, target, Math.cos(a) * knockback * factor, Math.sin(a) * knockback * factor);
  }

  if (blocked) w.events.push({ t: 'blocked', x: target.x, y: target.y, target: target.id });
  w.events.push({ t: 'hit', x: target.x, y: target.y, dmg: dealt, target: target.id, by });

  if (target.hp <= 0) {
    killPlayer(w, target, by);
    return { applied: dealt, blocked, killed: true };
  }
  return { applied: dealt, blocked, killed: false };
};

/**
 * 사망. 손에 든 무기와 소지 자원의 절반이 바닥에 떨어지고, 죽인 쪽은
 * 광석과 코어 조각을 받는다.
 *
 * 조각이 여기서 나오는 게 중요하다. 조각은 포탑에만 쓰이고 그 외에는 맵
 * 중앙에서만 나오므로, 킬 보상은 곧 "싸운 사람만 포탑을 세운다"는 규칙이 된다.
 */
export const killPlayer = (w: World, p: Player, by: PlayerId): void => {
  if (!p.alive) return;
  p.alive = false;
  p.hp = 0;
  p.deaths++;
  p.swingHitTick = 0;
  p.miningTile = -1;

  // 손에서 무엇이 튀어나갔는지는 죽음 이벤트에 실어 보낸다. 죽는 순간의
  // 스냅샷에는 이미 weapon이 null이라, 클라가 직전 프레임을 기억하지 않으면
  // 떨어지는 연출을 만들 수 없다.
  const dropped = p.weapon;
  if (dropped) {
    dropWeapon(w, p.x, p.y, dropped);
    p.weapon = null;
  }
  const ore = Math.floor(p.res.ore * PLAYER.dropResourceRatio);
  if (ore > 0) { p.res.ore -= ore; dropResource(w, p.x, p.y, 'ore', ore); }
  const shard = Math.floor(p.res.shard * PLAYER.dropResourceRatio);
  if (shard > 0) { p.res.shard -= shard; dropResource(w, p.x, p.y, 'shard', shard); }

  const killer = w.players.get(by);
  if (killer && killer.id !== p.id && killer.team !== p.team) {
    killer.kills++;
    killer.res.ore += PLAYER.killRewardOre;
    killer.res.shard += PLAYER.killRewardShard;
    w.events.push({
      t: 'bounty', id: killer.id,
      ore: PLAYER.killRewardOre, shard: PLAYER.killRewardShard,
    });
  }

  p.respawnTick = w.tick + PLAYER.respawnTicks;
  w.events.push({ t: 'death', id: p.id, by, weapon: dropped });
};

// ── 드롭 ─────────────────────────────────────────────────────────────────────

const scatter = (): number => (Math.random() - 0.5) * TILE * 0.8;

export const dropWeapon = (w: World, x: number, y: number, weapon: WeaponId, pickupDelay = 10): void => {
  w.drops.push({
    id: nextId(w), kind: 'weapon', weapon, amount: 1,
    x: x + scatter(), y: y + scatter(),
    dieTick: w.tick + RESOURCE.weaponDropLifetimeTicks,
    pickupTick: w.tick + pickupDelay,
  });
  trimWeaponDrops(w);
};

/**
 * 바닥의 무기가 상한을 넘으면 가장 오래된 것부터 치운다.
 *
 * 수명만으로는 난전 중에 몰려 쌓이는 것을 못 막는다. 방금 떨어진 전리품이
 * 눈에 띄어야 "죽이면 뺏는다"는 규칙이 화면에서 읽힌다.
 */
const trimWeaponDrops = (w: World): void => {
  let count = 0;
  for (const d of w.drops) if (d.kind === 'weapon') count++;
  let over = count - RESOURCE.maxWeaponDrops;
  if (over <= 0) return;
  // drops는 생성 순서대로 쌓이므로 앞에서부터 지우면 오래된 것부터 사라진다.
  for (let i = 0; i < w.drops.length && over > 0; i++) {
    if (w.drops[i].kind !== 'weapon') continue;
    w.drops.splice(i, 1);
    i--;
    over--;
  }
};

/**
 * 뚫린 칸에서 무기가 나올지 굴린다.
 *
 * 이게 이 게임에서 무기를 얻는 유일한 길이다(무기고는 같은 추첨을 대신 돌려줄 뿐).
 * 그래서 "파는 행위"에 광석과 무기라는 두 개의 보상이 동시에 걸려 있고,
 * 파다가 무기를 주우려면 곡괭이를 놓아야 하므로 보상이 곧 딜레마가 된다.
 */
export const rollTileLoot = (
  w: World, tx: number, ty: number, was: TileId, rnd: () => number = Math.random,
): WeaponId | null => {
  const chance =
    was === Tile.ORE_VEIN ? LOOT.oreVeinChance
    : was === Tile.STRUCTURE ? LOOT.structureChance
    : was === Tile.SOFT_WALL ? LOOT.softWallChance
    : 0;
  if (chance <= 0 || rnd() >= chance) return null;

  const weapon = rollWeapon(rnd());
  const x = tx * TILE + TILE / 2;
  const y = ty * TILE + TILE / 2;
  // 파낸 사람이 바로 집을 수 있어야 한다. 채굴 중 줍기 지연은 방해만 된다.
  dropWeapon(w, x, y, weapon, 0);
  w.events.push({ t: 'loot', x, y, weapon });
  return weapon;
};

/** 뚫은 칸에서 구급품이 나올지 굴린다. 무기 추첨과 독립이다. */
export const rollTileHealth = (
  w: World, tx: number, ty: number, was: TileId, rnd: () => number = Math.random,
): boolean => {
  if (was === Tile.STRUCTURE || !TILES[was].mineable) return false;
  if (rnd() >= LOOT.healthChance) return false;
  dropHealth(w, tx * TILE + TILE / 2, ty * TILE + TILE / 2, RESOURCE.healthAmount);
  return true;
};

export const dropResource = (
  w: World, x: number, y: number, kind: 'ore' | 'shard', amount: number,
): void => {
  w.drops.push({
    id: nextId(w), kind, weapon: null, amount,
    x: x + scatter(), y: y + scatter(),
    dieTick: w.tick + RESOURCE.dropLifetimeTicks,
    pickupTick: w.tick + 6,
  });
};

/**
 * 구급품. 체력이 가득하면 줍지 않고 그 자리에 남는다.
 *
 * 멀쩡할 때 밟고 지나갔다가, 다치고 나서 "아까 거기 있었지" 하며 되돌아가는
 * 것이 이 아이템의 제일 좋은 쓰임이다. 그래서 오래 남는다.
 */
export const dropHealth = (w: World, x: number, y: number, amount: number): void => {
  w.drops.push({
    id: nextId(w), kind: 'health', weapon: null, amount,
    x: x + scatter(), y: y + scatter(),
    dieTick: w.tick + RESOURCE.healthDropLifetimeTicks,
    pickupTick: w.tick + 6,
  });
};

// ── 지형·건물·코어 ───────────────────────────────────────────────────────────

export interface TileDamageResult {
  /** 이번 타격으로 부서졌는가. */
  broke: boolean;
  /** 부서져서 나온 광석. */
  ore: number;
  /** 유효 타격이었는가(불괴 지형이면 false). */
  hit: boolean;
}

const NO_HIT: TileDamageResult = { broke: false, ore: 0, hit: false };

export const damageTile = (
  w: World, tx: number, ty: number, amount: number, byTeam: TeamId | null = null,
): TileDamageResult => {
  if (!inBounds(tx, ty)) return NO_HIT;
  const i = tileIndex(tx, ty);
  const id = w.tiles[i] as TileId;

  if (id === Tile.STRUCTURE) return damageStructure(w, i, amount, byTeam);

  const core = coreAt(w, tx, ty);
  if (core) {
    if (byTeam !== null && core.team === byTeam) return NO_HIT;
    // 코어만은 준비 시간에 지킨다. 여기까지 닿을 방법은 사실상 없지만,
    // 승패가 준비 시간에 갈리는 경우를 지형 운에 맡기지는 않는다.
    if (w.phase === Phase.PREP) return NO_HIT;
    damageCore(w, core, amount);
    return { broke: false, ore: 0, hit: true };
  }

  if (!TILES[id].mineable) return NO_HIT;

  w.tileHp[i] = Math.max(0, w.tileHp[i] - Math.round(amount));
  w.dirtyTiles.add(i);
  if (w.tileHp[i] > 0) return { broke: false, ore: 0, hit: true };

  const ore = TILES[id].oreYield;
  setTile(w, tx, ty, Tile.EMPTY);
  w.events.push({ t: 'tileBroken', tile: i, was: id });
  rollTileLoot(w, tx, ty, id);
  rollTileHealth(w, tx, ty, id);
  return { broke: true, ore, hit: true };
};

export const damageStructure = (
  w: World, tileIdx: number, amount: number, byTeam: TeamId | null,
): TileDamageResult => {
  const s = w.structures.get(tileIdx);
  if (!s) return NO_HIT;
  s.hp -= Math.round(amount);
  w.tileHp[tileIdx] = Math.max(0, s.hp);
  w.dirtyTiles.add(tileIdx);
  if (s.hp > 0) return { broke: false, ore: 0, hit: true };

  w.structures.delete(tileIdx);
  w.tiles[tileIdx] = Tile.EMPTY;
  w.tileHp[tileIdx] = 0;
  w.dirtyTiles.add(tileIdx);
  w.events.push({ t: 'structureDown', tile: tileIdx });
  // 지은 자원의 일부를 돌려준다. 실수로 지은 벽을 부수는 비용을 낮춘다.
  const refund = Math.floor(structureDef(s.type).cost.ore * 0.3);
  if (refund > 0) {
    const owner = w.players.get(s.owner);
    if (owner) owner.res.ore += refund;
  }
  return { broke: true, ore: 0, hit: true };
};

export const damageCore = (w: World, core: Core, amount: number): void => {
  core.hp = Math.max(0, core.hp - Math.round(amount));
  w.events.push({ t: 'coreHit', team: core.team, hp: core.hp });
};
