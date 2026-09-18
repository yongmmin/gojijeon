/** 시뮬레이션 전역에서 쓰는 순수 수학 유틸. 부수효과 없음. */
import { MAP_TILES, TILE } from './config/balance.js';

export interface Vec2 { x: number; y: number }

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const dist2 = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};

export const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.sqrt(dist2(ax, ay, bx, by));

/** 두 각의 최소 차이를 [-PI, PI]로. */
export const angleDelta = (a: number, b: number): number => {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** 월드 좌표 → 타일 인덱스. */
export const toTileX = (wx: number): number => Math.floor(wx / TILE);
export const toTileY = (wy: number): number => Math.floor(wy / TILE);
/** 타일 인덱스 → 타일 중심의 월드 좌표. */
export const tileCenter = (t: number): number => t * TILE + TILE / 2;

export const inBounds = (tx: number, ty: number): boolean =>
  tx >= 0 && ty >= 0 && tx < MAP_TILES && ty < MAP_TILES;

export const tileIndex = (tx: number, ty: number): number => ty * MAP_TILES + tx;
export const tileXOf = (i: number): number => i % MAP_TILES;
export const tileYOf = (i: number): number => (i / MAP_TILES) | 0;

/** 결정적 난수. 같은 시드 → 같은 맵. 서버와 클라가 동일한 맵을 독립 생성한다. */
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
