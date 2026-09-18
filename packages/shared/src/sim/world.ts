/** World 생성과, 시뮬레이션 전체가 공유하는 타일/충돌 조회. */
import { MAP_TILES, PLAYER, TILE, MATCH } from '../config/balance.js';
import { structureDef } from '../buildings.js';
import { generateMap } from '../map/generator.js';
import { inBounds, tileIndex } from '../math.js';
import { Tile, TILES, type TileId } from '../tiles.js';
import { STARTING_WEAPON } from '../weapons.js';
import { clampIntoZone } from './zone.js';
import {
  ModeId, Phase, emptyInput,
  type Player, type PlayerId, type TeamId, type World,
} from '../types.js';

export interface CreateWorldOptions {
  seed: number;
  mode: ModeId;
  /** 팀전이면 팀 수, FFA면 스폰 지점 수. */
  spawnCount?: number;
  /** 준비 페이즈 길이. 싱글 플레이는 짧게 준다. */
  prepTicks?: number;
}

export const createWorld = ({ seed, mode, spawnCount, prepTicks }: CreateWorldOptions): World => {
  const count = spawnCount ?? (mode === ModeId.TEAM ? 2 : MATCH.maxPlayers);
  const map = generateMap({ seed, mode, spawnCount: count });

  const shardNodes = new Map<number, number>();
  for (const t of map.shardNodes) shardNodes.set(t, 0);

  return {
    tick: 0,
    prepTicks: prepTicks ?? MATCH.prepTicks,
    combatTicks: MATCH.combatTicks,
    seed,
    mode,
    phase: Phase.LOBBY,
    phaseEndTick: 0,
    round: 0,
    score: {},
    tiles: map.tiles,
    tileHp: map.tileHp,
    players: new Map(),
    structures: new Map(),
    cores: map.cores.map((c) => ({ ...c, hp: 2000, maxHp: 2000 })),
    outpost: { ...map.outpost, owner: null, capturing: null, progress: 0, contested: false },
    holdTicks: {},
    projectiles: [],
    drops: [],
    shardNodes,
    barrierTiles: map.barrierTiles,
    spawns: map.spawns,
    dirtyTiles: new Set(),
    nextEntityId: 1,
    events: [],
  };
};

// ── 타일 조회 ────────────────────────────────────────────────────────────────

export const getTile = (w: World, tx: number, ty: number): TileId =>
  inBounds(tx, ty) ? (w.tiles[tileIndex(tx, ty)] as TileId) : Tile.HARD_WALL;

export const setTile = (w: World, tx: number, ty: number, id: TileId): void => {
  if (!inBounds(tx, ty)) return;
  const i = tileIndex(tx, ty);
  w.tiles[i] = id;
  w.tileHp[i] = TILES[id].hp;
  w.dirtyTiles.add(i);
};

/**
 * 이 칸이 `team`에게 막혀 있는가.
 * 문(friendlyPassable)만 팀에 따라 답이 달라지므로, 통행 판정은 항상 팀을 받는다.
 */
export const isBlocked = (w: World, tx: number, ty: number, team: TeamId | null): boolean => {
  const id = getTile(w, tx, ty);
  if (id === Tile.STRUCTURE) {
    const s = w.structures.get(tileIndex(tx, ty));
    if (!s) return false;
    const d = structureDef(s.type);
    if (!d.solid) return false;
    if (d.friendlyPassable && team !== null && s.team === team) return false;
    return true;
  }
  return TILES[id].solid;
};

/** 원이 이 지점에 놓일 수 있는가. 주변 3×3 칸만 본다. */
export const circleFits = (
  w: World, x: number, y: number, r: number, team: TeamId | null,
): boolean => {
  const minTx = Math.floor((x - r) / TILE);
  const maxTx = Math.floor((x + r) / TILE);
  const minTy = Math.floor((y - r) / TILE);
  const maxTy = Math.floor((y + r) / TILE);
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (!isBlocked(w, tx, ty, team)) continue;
      // 원 ↔ AABB 최근접점 거리.
      const nx = Math.max(tx * TILE, Math.min(x, tx * TILE + TILE));
      const ny = Math.max(ty * TILE, Math.min(y, ty * TILE + TILE));
      const dx = x - nx, dy = y - ny;
      if (dx * dx + dy * dy < r * r) return false;
    }
  }
  return true;
};

// ── 플레이어 ─────────────────────────────────────────────────────────────────

export const createPlayer = (
  w: World, id: PlayerId, name: string, team: TeamId, bot = false,
): Player => {
  const p: Player = {
    id, name, team,
    x: 0, y: 0, vx: 0, vy: 0, aim: 0,
    hp: PLAYER.maxHp,
    alive: false,
    weapon: STARTING_WEAPON,
    res: { ore: 0, shard: 0 },
    swingHitTick: 0,
    readyTick: 0,
    invulnUntilTick: 0,
    respawnTick: 0,
    miningTile: -1,
    kills: 0,
    deaths: 0,
    connected: true,
    bot,
    spectating: true,
    input: emptyInput(),
    lastButtons: 0,
  };
  w.players.set(id, p);
  return p;
};

/**
 * 팀의 스폰 지점 중 적이 가장 먼 곳. 스폰킬을 구조적으로 줄인다.
 *
 * 동점이면 **무작위로** 고른다. 예전에는 늘 첫 후보를 집어서, 적이 아무도
 * 살아 있지 않은 라운드 시작 때 팀원 전원이 같은 자리에 겹쳐 나왔다.
 * 자리를 여럿 만들어 둔 의미가 없었다.
 */
export const pickSpawn = (w: World, team: TeamId): { x: number; y: number } => {
  const mine = w.spawns.filter((s) => s.team === team);
  const candidates = mine.length > 0 ? mine : w.spawns;

  // 적이 하나도 없으면 모든 자리의 점수가 같다. 그 값을 Infinity로 두면
  // `Infinity - 1 === Infinity`라서 동점 판정이 통째로 무너진다(실제로 당했다).
  // 맵을 가로지르는 거리보다 큰 유한한 값을 쓴다.
  const FAR = MAP_SIZE_PX * 2;

  let bestScore = -1;
  let best: typeof candidates = [];
  for (const c of candidates) {
    let nearest = FAR;
    for (const p of w.players.values()) {
      if (!p.alive || p.team === team) continue;
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < nearest) nearest = d;
    }
    // 완전히 같을 때만이 아니라 "비슷하면" 같은 급으로 본다. 픽셀 단위로
    // 갈리는 차이 때문에 매번 같은 자리가 뽑히는 것을 막는다.
    if (nearest > bestScore + 1) { bestScore = nearest; best = [c]; }
    else if (nearest > bestScore - 1) best.push(c);
  }

  const pick = best[Math.floor(Math.random() * best.length)] ?? candidates[0];
  return { x: pick.x, y: pick.y };
};

export const respawn = (w: World, p: Player): void => {
  const s = pickSpawn(w, p.team);
  const safe = safeSpawnPoint(w, p, s);
  p.x = safe.x;
  p.y = safe.y;
  p.vx = 0; p.vy = 0;
  p.hp = PLAYER.maxHp;
  p.alive = true;
  p.spectating = false;
  p.weapon = STARTING_WEAPON;
  p.swingHitTick = 0;
  p.readyTick = w.tick;
  p.miningTile = -1;
  p.invulnUntilTick = w.tick + PLAYER.spawnProtectTicks;
  w.events.push({ t: 'spawn', id: p.id });
};

/**
 * 구역 안이면서 **몸이 들어가는** 자리를 찾는다.
 *
 * 구역이 좁아지면 기지가 붕괴 구역 밖에 남는다. 거기서 부활시키면 살아나자마자
 * 피가 닳으므로 안으로 당겨야 하는데, 당긴 지점이 흙벽 한복판일 수 있다 —
 * 실제로 내구 테스트에서 벽에 박힌 봇이 나왔다.
 *
 * 그래서 당긴 자리부터 중심 쪽으로 조금씩 옮겨 가며 첫 번째로 설 수 있는 곳을
 * 쓴다. 끝내 못 찾으면 원래 스폰으로 돌아간다 — 구역 밖에서 피가 닳는 편이
 * 벽에 박혀 아무것도 못 하는 것보다 낫다.
 */
const safeSpawnPoint = (
  w: World, p: Player, spawn: { x: number; y: number },
): { x: number; y: number } => {
  const target = clampIntoZone(w, spawn.x, spawn.y);
  if (target.x === spawn.x && target.y === spawn.y) return spawn;

  const cx = MAP_SIZE_PX / 2;
  const cy = MAP_SIZE_PX / 2;
  const dx = cx - target.x;
  const dy = cy - target.y;
  const len = Math.hypot(dx, dy) || 1;

  for (let step = 0; step <= 24; step++) {
    const x = target.x + (dx / len) * step * TILE;
    const y = target.y + (dy / len) * step * TILE;
    if (circleFits(w, x, y, PLAYER.radius, p.team)) return { x, y };
  }
  return spawn;
};

export const nextId = (w: World): number => w.nextEntityId++;

export const MAP_SIZE_PX = MAP_TILES * TILE;
