/** World 생성과, 시뮬레이션 전체가 공유하는 타일/충돌 조회. */
import { MAP_TILES, PLAYER, TILE, MATCH } from '../config/balance.js';
import { structureDef } from '../buildings.js';
import { generateMap } from '../map/generator.js';
import { inBounds, tileIndex } from '../math.js';
import { Tile, TILES, type TileId } from '../tiles.js';
import { STARTING_WEAPON } from '../weapons.js';
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

/** 팀의 스폰 지점 중 적이 가장 먼 곳. 스폰킬을 구조적으로 줄인다. */
export const pickSpawn = (w: World, team: TeamId): { x: number; y: number } => {
  const mine = w.spawns.filter((s) => s.team === team);
  const candidates = mine.length > 0 ? mine : w.spawns;
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const c of candidates) {
    let nearest = Infinity;
    for (const p of w.players.values()) {
      if (!p.alive || p.team === team) continue;
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d < nearest) nearest = d;
    }
    if (nearest > bestScore) { bestScore = nearest; best = c; }
  }
  return { x: best.x, y: best.y };
};

export const respawn = (w: World, p: Player): void => {
  const s = pickSpawn(w, p.team);
  p.x = s.x;
  p.y = s.y;
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

export const nextId = (w: World): number => w.nextEntityId++;

export const MAP_SIZE_PX = MAP_TILES * TILE;
