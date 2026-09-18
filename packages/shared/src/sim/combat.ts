/**
 * 전투.
 *
 * 설계의 중심: **행동은 "휘두르기" 하나뿐이다.** 무엇을 다치게 하는지는
 * 무기 정의가 정한다. 곡괭이는 땅을 크게·사람을 조금, 단검은 그 반대다.
 * 덕분에 "채굴 버튼"과 "공격 버튼"을 나눌 필요가 없고, 곡괭이를 든 채
 * 적을 만났을 때의 무력함이 규칙이 아니라 수치에서 자연스럽게 나온다.
 */
import { DT, MINING, TILE, BUILDING } from '../config/balance.js';
import { angleDelta, dist2, inBounds, tileIndex, toTileX, toTileY } from '../math.js';
import { Tile } from '../tiles.js';
import { STARTING_WEAPON, swingSeconds, tileDps, weaponDef, type WeaponDef, type WeaponId } from '../weapons.js';
import type { Player, Projectile, World } from '../types.js';
import { circleFits, getTile, nextId } from './world.js';
import { coreAt, damagePlayer, damageTile } from './damage.js';

/** 곡괭이의 초당 굴착 속도. 다른 무기의 대체 굴착은 여기서 비례로 끌어온다. */
const PICKAXE_TILE_DPS = tileDps(weaponDef(STARTING_WEAPON));

/**
 * 굴착 도구가 아닌 무기로 팔 때의 한 방 위력.
 *
 * 무기마다 휘두르는 주기가 다르므로, 목표 "초당 속도"를 정하고 그 무기의
 * 주기를 곱해 한 방 위력을 거꾸로 계산한다. 그래야 어떤 무기를 들든
 * 굴착 속도가 곡괭이의 정확히 nonPickaxeMultiplier배가 된다.
 */
const fallbackMiningPower = (def: WeaponDef | null): number => {
  const cycle = def ? swingSeconds(def) : 0.5;
  return PICKAXE_TILE_DPS * MINING.nonPickaxeMultiplier * cycle;
};

/** 이 팀에게 적인가. FFA에서는 팀 번호가 전부 달라서 자동으로 전원이 적이 된다. */
export const isEnemy = (a: Player, b: Player): boolean => a.team !== b.team;

/**
 * 조준선을 따라가며 처음 만나는 "때릴 수 있는" 타일을 찾는다.
 * 굴착·철거·코어 타격이 전부 이 하나의 조회를 쓴다.
 */
export const traceTargetTile = (
  w: World, p: Player, range: number,
): { tx: number; ty: number } | null => {
  const step = TILE * 0.3;
  const steps = Math.ceil(range / step);
  const cx = Math.cos(p.aim), cy = Math.sin(p.aim);
  for (let i = 1; i <= steps; i++) {
    const x = p.x + cx * step * i;
    const y = p.y + cy * step * i;
    const tx = toTileX(x), ty = toTileY(y);
    if (!inBounds(tx, ty)) return null;
    const id = getTile(w, tx, ty);
    if (id === Tile.EMPTY) continue;
    if (id === Tile.SHARD_NODE) continue; // 캘 수 없다. 통과시켜 뒤쪽을 노릴 수 있게.
    return { tx, ty };
  }
  return null;
};

/** 휘두르기 시작. 선딜이 끝나는 틱을 예약할 뿐, 판정은 그때 일어난다. */
export const beginSwing = (w: World, p: Player): boolean => {
  if (!p.alive || w.tick < p.readyTick || p.swingHitTick > 0) return false;
  const def = p.weapon ? weaponDef(p.weapon) : null;
  const windup = def ? def.windupTicks : 3;
  p.swingHitTick = w.tick + windup;
  p.readyTick = p.swingHitTick + (def ? def.recoverTicks : 6);
  return true;
};

/** 선딜이 끝난 순간의 판정. */
export const resolveSwing = (w: World, p: Player): void => {
  p.swingHitTick = 0;
  if (!p.alive) return;

  const def = p.weapon ? weaponDef(p.weapon) : null;

  // 원거리·투척은 투사체를 낳고 끝난다.
  if (def?.projectile) {
    spawnProjectile(w, p, p.weapon as WeaponId);
    if (def.consumable) p.weapon = null;
    return;
  }

  const damage = def?.damage ?? 6;
  const range = def?.range ?? TILE * 1.1;
  const halfArc = def?.halfArc ?? Math.PI / 5;

  // 1. 부채꼴 안의 적. 가까운 순으로 하나만 맞는다 — 난전에서 광역 무기가 되지 않게.
  let best: Player | null = null;
  let bestD = Infinity;
  for (const other of w.players.values()) {
    if (other.id === p.id || !other.alive || !isEnemy(p, other)) continue;
    const d2 = dist2(p.x, p.y, other.x, other.y);
    if (d2 > (range + 11) ** 2 || d2 > bestD) continue;
    const a = Math.atan2(other.y - p.y, other.x - p.x);
    if (Math.abs(angleDelta(a, p.aim)) > halfArc) continue;
    best = other; bestD = d2;
  }
  if (best) damagePlayer(w, best, damage, p.id, p.x, p.y);

  // 2. 지형·건물·코어. 적을 때렸어도 같이 판정한다 — 벽에 몰린 적을 치면
  //    뒤의 벽도 깎이는 게 직관에 맞는다.
  const mine = def?.miningPower ?? 0;
  const build = def?.buildPower ?? 0;
  if (mine <= 0 && build <= 0 && damage <= 0) return;

  const reach = Math.max(
    range,
    mine > 0 ? MINING.range : MINING.minReach,
    build > 0 ? BUILDING.range : 0,
  );
  const target = traceTargetTile(w, p, reach);
  if (!target) { p.miningTile = -1; return; }

  const id = getTile(w, target.tx, target.ty);
  const idx = tileIndex(target.tx, target.ty);

  let power: number;
  if (id === Tile.STRUCTURE) {
    const s = w.structures.get(idx);
    const friendly = s ? s.team === p.team : false;
    power = Math.max(build, mine, damage * 0.5);
    if (friendly) power *= BUILDING.friendlyDemolishMultiplier;
  } else if (coreAt(w, target.tx, target.ty)) {
    power = damage; // 코어는 무기로 때린다. 곡괭이로는 하세월이다.
  } else {
    // 무기를 든 채로도 팔 수는 있다. 다만 느리다.
    power = mine > 0 ? mine : fallbackMiningPower(def);
  }

  const res = damageTile(w, target.tx, target.ty, power, p.team);
  p.miningTile = res.hit && !res.broke ? idx : -1;
  if (res.ore > 0) p.res.ore += res.ore;
};

// ── 투사체 ───────────────────────────────────────────────────────────────────

export const spawnProjectile = (w: World, p: Player, weapon: WeaponId): void => {
  const def = weaponDef(weapon);
  const spec = def.projectile;
  if (!spec) return;
  const muzzle = 16;
  w.projectiles.push({
    id: nextId(w),
    owner: p.id,
    team: p.team,
    x: p.x + Math.cos(p.aim) * muzzle,
    y: p.y + Math.sin(p.aim) * muzzle,
    vx: Math.cos(p.aim) * spec.speed,
    vy: Math.sin(p.aim) * spec.speed,
    radius: spec.radius,
    damage: spec.damage,
    tileDamage: spec.tileDamage,
    dieTick: w.tick + (def.explosion ? def.explosion.fuseTicks : spec.lifetimeTicks),
    weapon,
    explodesAs: def.explosion ? weapon : null,
  });
};

/** 두 점 사이가 뚫려 있는가. 포탑 조준과 (나중에) 시야 계산이 함께 쓴다. */
export const losClear = (w: World, x0: number, y0: number, x1: number, y1: number): boolean => {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.ceil(Math.hypot(dx, dy) / (TILE * 0.4));
  for (let i = 1; i < steps; i++) {
    const x = x0 + (dx * i) / steps;
    const y = y0 + (dy * i) / steps;
    if (!circleFits(w, x, y, 2, null)) return false;
  }
  return true;
};

/** 포탑 등, 플레이어가 아닌 발사체. */
export const spawnBolt = (
  w: World, x: number, y: number, angle: number, team: number,
  speed: number, damage: number, lifetimeTicks: number,
): void => {
  w.projectiles.push({
    id: nextId(w), owner: -1, team,
    x, y,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    radius: 4, damage, tileDamage: 0,
    dieTick: w.tick + lifetimeTicks,
    weapon: null,
    explodesAs: null,
  });
};

export const updateProjectiles = (w: World): void => {
  const alive: Projectile[] = [];
  for (const pr of w.projectiles) {
    let removed = false;
    // 빠른 투사체가 벽을 지나치지 않도록 잘게 나눠 전진한다.
    const stepCount = Math.max(1, Math.ceil((Math.hypot(pr.vx, pr.vy) * DT) / (TILE * 0.4)));
    for (let s = 0; s < stepCount && !removed; s++) {
      pr.x += (pr.vx * DT) / stepCount;
      pr.y += (pr.vy * DT) / stepCount;

      if (!circleFits(w, pr.x, pr.y, pr.radius, null)) {
        if (pr.explodesAs) explode(w, pr);
        else {
          const tx = toTileX(pr.x), ty = toTileY(pr.y);
          if (pr.tileDamage > 0) damageTile(w, tx, ty, pr.tileDamage, pr.team);
        }
        removed = true;
        break;
      }

      for (const target of w.players.values()) {
        if (!target.alive || target.team === pr.team) continue;
        const rr = (pr.radius + 11) ** 2;
        if (dist2(pr.x, pr.y, target.x, target.y) > rr) continue;
        if (pr.explodesAs) explode(w, pr);
        else damagePlayer(w, target, pr.damage, pr.owner, pr.x, pr.y);
        removed = true;
        break;
      }
    }

    if (!removed && w.tick >= pr.dieTick) {
      if (pr.explodesAs) explode(w, pr);
      removed = true;
    }
    if (!removed) alive.push(pr);
  }
  w.projectiles = alive;
};

export const explode = (w: World, pr: Projectile): void => {
  const def = weaponDef(pr.explodesAs as WeaponId);
  const ex = def.explosion;
  if (!ex) return;

  w.events.push({ t: 'explosion', x: pr.x, y: pr.y, radius: ex.radius });

  for (const target of w.players.values()) {
    if (!target.alive) continue;
    const d = Math.sqrt(dist2(pr.x, pr.y, target.x, target.y));
    if (d > ex.radius) continue;
    const falloff = 1 - (d / ex.radius) * 0.5;
    // 자폭도 아프다. 던지고 도망칠 시간을 계산하게 만든다.
    damagePlayer(w, target, ex.damage * falloff, pr.owner, pr.x, pr.y, 40);
  }

  const ctx = toTileX(pr.x), cty = toTileY(pr.y);
  for (let dy = -ex.tileRadius; dy <= ex.tileRadius; dy++) {
    for (let dx = -ex.tileRadius; dx <= ex.tileRadius; dx++) {
      if (dx * dx + dy * dy > ex.tileRadius * ex.tileRadius + 0.5) continue;
      damageTile(w, ctx + dx, cty + dy, ex.tileDamage, null);
    }
  }
};
