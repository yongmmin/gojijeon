/**
 * 시드 기반 맵 생성기.
 *
 * 두 가지를 보장한다.
 *  1) 결정적: 같은 시드 → 같은 맵. 그래서 서버가 맵을 통째로 보내지 않아도 된다.
 *  2) 회전 대칭: 모든 지형 특징을 스폰 수만큼 회전 복사한다. 자리 운이 승패를
 *     가르지 않게 하는 가장 값싼 방법이다.
 *
 * 기본 채움재는 흙벽이다. 즉 플레이어는 "갇힌 채로 시작해서 파고 나온다".
 * 이게 준비 페이즈에 할 일을 만들어 준다.
 */
import { MAP_TILES, TILE } from '../config/balance.js';
import { mulberry32, tileIndex, inBounds, tileCenter } from '../math.js';
import { Tile, TILES, type TileId } from '../tiles.js';
import { ModeId, type TeamId } from '../types.js';

const CENTER = MAP_TILES / 2;
/** 중앙 교전장 반경(타일). */
const ARENA_R = 13;
/** 준비 페이즈 봉쇄벽이 서는 반경. */
const BARRIER_R = 15;
/** 스폰 기지가 놓이는 반경. */
const BASE_ORBIT = 46;

export interface GeneratedMap {
  tiles: Uint8Array;
  tileHp: Uint16Array;
  spawns: Array<{ team: TeamId; x: number; y: number }>;
  cores: Array<{ team: TeamId; tx: number; ty: number }>;
  shardNodes: number[];
  /** 중앙 상징물과, 점령 시 포탑이 설 칸. */
  outpost: { tx: number; ty: number; turretTx: number; turretTy: number };
  /** 봉쇄벽 타일들. 전투 시작 시 한 번에 무너뜨리기 위해 기억해 둔다. */
  barrierTiles: number[];
}

interface Grid {
  t: Uint8Array;
  set(tx: number, ty: number, id: TileId): void;
  get(tx: number, ty: number): TileId;
}

const makeGrid = (): Grid => {
  const t = new Uint8Array(MAP_TILES * MAP_TILES).fill(Tile.SOFT_WALL);
  return {
    t,
    set(tx, ty, id) { if (inBounds(tx, ty)) t[tileIndex(tx, ty)] = id; },
    get(tx, ty) { return inBounds(tx, ty) ? (t[tileIndex(tx, ty)] as TileId) : Tile.HARD_WALL; },
  };
};

const disc = (g: Grid, cx: number, cy: number, r: number, id: TileId, only?: TileId): void => {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      if (only !== undefined && g.get(x, y) !== only) continue;
      g.set(x, y, id);
    }
  }
};

const ring = (
  g: Grid, cx: number, cy: number, r: number, thickness: number, id: TileId,
  gaps: Array<{ angle: number; halfWidth: number }> = [],
): number[] => {
  const written: number[] = [];
  const inner = (r - thickness / 2) ** 2;
  const outer = (r + thickness / 2) ** 2;
  for (let y = Math.floor(cy - r - thickness); y <= Math.ceil(cy + r + thickness); y++) {
    for (let x = Math.floor(cx - r - thickness); x <= Math.ceil(cx + r + thickness); x++) {
      const dx = x - cx, dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < inner || d2 > outer) continue;
      const a = Math.atan2(dy, dx);
      let skip = false;
      for (const gap of gaps) {
        let d = Math.abs(((a - gap.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (d < gap.halfWidth) { skip = true; break; }
      }
      if (skip) continue;
      if (!inBounds(x, y)) continue;
      g.set(x, y, id);
      written.push(tileIndex(x, y));
    }
  }
  return written;
};

/** 기지 방의 반경. 진입로 시작점과 기지 고리가 같은 값을 써야 서로 닿는다. */
const baseRadius = (mode: ModeId): number => (mode === ModeId.TEAM ? 7 : 5);

/** (dx, dy)를 원점 기준으로 회전. 대칭 복사의 유일한 도구. */
const rot = (dx: number, dy: number, a: number): [number, number] => {
  const c = Math.cos(a), s = Math.sin(a);
  return [dx * c - dy * s, dx * s + dy * c];
};

export interface GenerateOptions {
  seed: number;
  mode: ModeId;
  /** 팀전이면 팀 수(2), FFA면 스폰 지점 수(=최대 인원). */
  spawnCount: number;
}

export const generateMap = ({ seed, mode, spawnCount }: GenerateOptions): GeneratedMap => {
  const rnd = mulberry32(seed);
  const g = makeGrid();
  const n = Math.max(2, spawnCount);
  const step = (Math.PI * 2) / n;

  // 1. 맵 외곽 — 절대 뚫리지 않는다.
  for (let y = 0; y < MAP_TILES; y++) {
    for (let x = 0; x < MAP_TILES; x++) {
      if (x < 2 || y < 2 || x >= MAP_TILES - 2 || y >= MAP_TILES - 2) g.set(x, y, Tile.HARD_WALL);
    }
  }

  // 2. 자연 지형: 암반 덩어리와 광맥을 한 조각(wedge)에 뿌리고 n번 회전 복사한다.
  const featureCount = 14;
  for (let i = 0; i < featureCount; i++) {
    const r = 20 + rnd() * 38;
    const a0 = rnd() * step;
    const kind = rnd();
    const size = kind < 0.45 ? 2 + rnd() * 2.5 : 1 + rnd() * 1.6;
    const id: TileId = kind < 0.45 ? Tile.HARD_WALL : Tile.ORE_VEIN;
    for (let k = 0; k < n; k++) {
      const [dx, dy] = rot(Math.cos(a0) * r, Math.sin(a0) * r, step * k);
      disc(g, CENTER + dx, CENTER + dy, size, id, Tile.SOFT_WALL);
    }
  }

  // 3. 중앙 교전장과 코어 조각 노드. 조각을 여기에만 두는 게
  //    "구석에 틀어박히기"를 막는 유일한 장치다.
  disc(g, CENTER, CENTER, ARENA_R, Tile.EMPTY);
  const shardNodes: number[] = [];
  const nodeCount = 3;
  for (let i = 0; i < nodeCount; i++) {
    const a = (Math.PI * 2 * i) / nodeCount + step * 0.5;
    const tx = Math.round(CENTER + Math.cos(a) * 5);
    const ty = Math.round(CENTER + Math.sin(a) * 5);
    g.set(tx, ty, Tile.SHARD_NODE);
    shardNodes.push(tileIndex(tx, ty));
  }

  // 4. 고지. 밟고 서야 하므로 통행을 막지 않는다.
  const outTx = Math.round(CENTER);
  const outTy = Math.round(CENTER);
  g.set(outTx, outTy, Tile.OUTPOST);
  // 점령 포탑 자리는 미리 못 박아 둔다. 그래야 주인이 바뀔 때마다 같은 칸에서
  // 갈아 끼우면 되고, 빈 칸을 찾아 헤매다 엉뚱한 곳에 서는 일이 없다.
  const turretTx = outTx;
  const turretTy = outTy - 3;
  g.set(turretTx, turretTy, Tile.EMPTY);

  // 5. 기지: 빈 방 + 암반 고리. 고리에는 두 개의 틈이 있다.
  //    중앙을 향한 정문과, 바깥을 향한 뒷문. 뒷문은 흙벽 한복판에 묻혀 있어서
  //    거기로 들어오려면 긴 땅굴을 파야 한다. 정면 돌파 대 우회 굴착의 구도.
  const spawns: GeneratedMap['spawns'] = [];
  const cores: GeneratedMap['cores'] = [];
  const baseR = baseRadius(mode);
  for (let k = 0; k < n; k++) {
    const a = step * k;
    const bx = CENTER + Math.cos(a) * BASE_ORBIT;
    const by = CENTER + Math.sin(a) * BASE_ORBIT;
    disc(g, bx, by, baseR - 1, Tile.EMPTY);
    ring(g, bx, by, baseR, 2, Tile.HARD_WALL, [
      { angle: a + Math.PI, halfWidth: 0.34 }, // 정문(중앙 방향)
      { angle: a, halfWidth: 0.2 },            // 뒷문(맵 바깥 방향)
    ]);

    const team: TeamId = mode === ModeId.TEAM ? k % 2 : k;
    // 기지마다 스폰 지점을 여럿 둔다. 하나뿐이면 팀원 넷이 같은 픽셀에 겹쳐 나오고,
    // 적이 입구를 잡았을 때 고를 여지가 사라진다.
    const seats = 3;
    for (let i = 0; i < seats; i++) {
      const sa = a + Math.PI + (i - (seats - 1) / 2) * 0.7;
      const sx = Math.round(bx + Math.cos(sa) * (baseR - 3.2));
      const sy = Math.round(by + Math.sin(sa) * (baseR - 3.2));
      spawns.push({ team, x: tileCenter(sx), y: tileCenter(sy) });
    }

    if (mode === ModeId.TEAM) {
      // 코어는 기지 안쪽, 중앙 반대편 구석에 둔다. 들어와서도 한 번 더 걸어야 한다.
      const ctx = Math.round(bx + Math.cos(a) * (baseR - 3));
      const cty = Math.round(by + Math.sin(a) * (baseR - 3));
      cores.push({ team, tx: ctx, ty: cty });
      g.set(ctx, cty, Tile.HARD_WALL);
    }
  }

  // 6. 기지에서 중앙으로 이어지는 진입로.
  //
  //    반드시 연결되어야 한다. 무작위로 걷게 두면 굴이 엉뚱한 데서 끊겨,
  //    전투가 시작되고 나서 중앙에 닿는 데만 1~2분이 걸린다(실측). 고지를
  //    빨리 잡는 게 목적인 게임에서 그 시간은 통째로 죽은 시간이다.
  //
  //    대신 구불구불하게 만들어 "빠르지만 예측 가능한 길"로 둔다. 곧은 길이
  //    싫으면 흙을 파서 질러가면 되고, 그게 굴착이 전략인 이유가 된다.
  //
  //    **무엇이든 뚫고 지나간다.** 흙벽만 치우게 했더니 자연 암반 덩어리가
  //    길 위에 얹혀 길을 영구히 끊었다(암반은 팔 수도 없다). 기지 고리보다
  //    나중에 파는 것도 같은 이유다 — 고리가 길을 덮으면 정문이 막힌다.
  for (let k = 0; k < n; k++) {
    const a = step * k;
    const fromR = BASE_ORBIT - baseRadius(mode) + 1;
    const toR = ARENA_R - 1;
    const turns = 1 + Math.floor(rnd() * 2);
    const wobble = 0.18 + rnd() * 0.16;
    const samples = Math.ceil((fromR - toR) * 2);
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const r = fromR + (toR - fromR) * t;
      const ang = a + Math.sin(t * Math.PI * turns) * wobble;
      disc(g, CENTER + Math.cos(ang) * r, CENTER + Math.sin(ang) * r, 1.4, Tile.EMPTY);
    }
  }

  // 7. 준비 페이즈 봉쇄벽. 진입로보다 나중에 세워야 중앙이 확실히 막힌다.
  const barrierTiles = ring(g, CENTER, CENTER, BARRIER_R, 2, Tile.BARRIER);

  // 8. 굴착 진행도 초기화.
  const tileHp = new Uint16Array(MAP_TILES * MAP_TILES);
  for (let i = 0; i < g.t.length; i++) tileHp[i] = TILES[g.t[i] as TileId].hp;

  return {
    tiles: g.t, tileHp, spawns, cores, shardNodes, barrierTiles,
    outpost: { tx: outTx, ty: outTy, turretTx, turretTy },
  };
};

export const MAP_PIXELS = MAP_TILES * TILE;
export const MAP_META = { CENTER, ARENA_R, BARRIER_R, BASE_ORBIT } as const;
