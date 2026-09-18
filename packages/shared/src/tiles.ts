/**
 * 타일 레지스트리.
 *
 * 타일 종류를 추가할 때 건드리는 곳은 이 파일 하나다. 충돌·굴착·렌더·수확은
 * 전부 아래 정의를 읽어서 동작하므로, 시뮬레이션 쪽에 타일별 분기를 심지 않는다.
 *
 * **팔 수 있는가를 한눈에 알 수 있어야 한다.** 플레이테스터가 "남색 벽돌은
 * 못 깨부수는 거냐"고 물었다 — 바닥(#1b1f28)과 암반(#2e3440)이 둘 다 남색이라
 * 구분이 안 됐기 때문이다. 그래서 색을 갈랐고, 색만으로는 또 헷갈릴 수 있어
 * 질감(texture)까지 선언한다. 규칙은 하나다:
 *
 *   **따뜻한 색(갈색·금색) = 팔 수 있다. 차가운 색(회청색) = 못 판다.**
 */

export const Tile = {
  EMPTY: 0,
  /** 팔 수 있는 흙·바위. 맵의 기본 채움재이자 땅굴의 재료. */
  SOFT_WALL: 1,
  /** 불괴. 맵 외곽과 코어 보호벽. */
  HARD_WALL: 2,
  /** 광맥. 캐면 광석을 많이 준다. */
  ORE_VEIN: 3,
  /** 코어 조각 노드. 캘 수 없고, 시간당 조각을 뱉는다. 맵 중앙에만 존재. */
  SHARD_NODE: 4,
  /** 준비 페이즈 동안만 존재하는 중앙 봉쇄벽. 전투 시작 시 무너진다. */
  BARRIER: 5,
  /** 플레이어 건축물이 점유한 칸. 실제 정보는 Structure 쪽에 있다. */
  STRUCTURE: 6,
  /** 맵 한가운데의 상징물. 밟고 설 수 있어야 하므로 통행을 막지 않는다. */
  OUTPOST: 7,
} as const;

export type TileId = (typeof Tile)[keyof typeof Tile];

export interface TileDef {
  readonly id: TileId;
  readonly name: string;
  /** 플레이어·투사체가 통과할 수 없는가. */
  readonly solid: boolean;
  /** 곡괭이로 팔 수 있는가. false면 어떤 피해도 받지 않는다. */
  readonly mineable: boolean;
  /** 굴착에 필요한 총 피해량. mineable이 false면 의미 없다. */
  readonly hp: number;
  /** 다 캤을 때 나오는 광석. */
  readonly oreYield: number;
  /** 시야를 막는가. */
  readonly opaque: boolean;
  /** 렌더 기본색(클라가 이 값을 그대로 쓴다). */
  readonly color: string;
  /**
   * 그리는 방식. 색만으로는 비슷한 두 타일이 섞여 보이므로 질감으로 한 번 더 가른다.
   *  - flat   : 평평한 바닥. 아무 무늬 없음
   *  - dirt   : 팔 수 있는 흙. 오돌토돌한 점무늬
   *  - stone  : 못 파는 암반. 딱딱한 사선 빗금과 밝은 윗면
   *  - ore    : 팔 수 있는 광맥. 박힌 알갱이
   *  - energy : 빛나는 것(봉쇄벽·조각 노드·고지). 맥동
   */
  readonly texture: 'flat' | 'dirt' | 'stone' | 'ore' | 'energy';
}

const def = (d: TileDef): TileDef => d;

export const TILES: Readonly<Record<TileId, TileDef>> = {
  [Tile.EMPTY]: def({
    id: Tile.EMPTY, name: '바닥',
    solid: false, mineable: false, hp: 0, oreYield: 0, opaque: false,
    // 벽보다 확실히 어두워야 "뚫린 곳"으로 읽힌다.
    color: '#12151b', texture: 'flat',
  }),
  [Tile.SOFT_WALL]: def({
    id: Tile.SOFT_WALL, name: '흙벽',
    // 30이었다. "캐는 게 너무 오래 걸린다"는 말이 나와 낮췄다. 파는 것이
    // 이동 수단이자 탐색인 게임에서, 한 칸에 오래 걸리면 모든 것이 느려진다.
    solid: true, mineable: true, hp: 20, oreYield: 3, opaque: true,
    color: '#7a5636', texture: 'dirt',
  }),
  [Tile.HARD_WALL]: def({
    id: Tile.HARD_WALL, name: '암반',
    solid: true, mineable: false, hp: 0, oreYield: 0, opaque: true,
    // 바닥과 같은 남색이어서 "이건 못 파는 건가?"라는 질문을 낳았다.
    // 확실히 밝고 차가운 회청색으로 올려 벽처럼 보이게 한다.
    color: '#5b6878', texture: 'stone',
  }),
  [Tile.ORE_VEIN]: def({
    id: Tile.ORE_VEIN, name: '광맥',
    // 흙벽과 같은 비율로 낮췄다(70 → 45). 흙벽보다 두 배 넘게 걸리되,
    // 한 번 붙었을 때 포기하고 싶어지는 시간은 아니어야 한다.
    solid: true, mineable: true, hp: 45, oreYield: 14, opaque: true,
    color: '#b8862b', texture: 'ore',
  }),
  [Tile.SHARD_NODE]: def({
    id: Tile.SHARD_NODE, name: '코어 노드',
    solid: true, mineable: false, hp: 0, oreYield: 0, opaque: false,
    color: '#4fd1c5', texture: 'energy',
  }),
  [Tile.BARRIER]: def({
    id: Tile.BARRIER, name: '봉쇄벽',
    solid: true, mineable: false, hp: 0, oreYield: 0, opaque: true,
    // 곧 사라질 것이므로 암반과 달라야 한다. 파랗게 빛나는 쪽.
    color: '#4d7fd6', texture: 'energy',
  }),
  [Tile.OUTPOST]: def({
    id: Tile.OUTPOST, name: '고지',
    solid: false, mineable: false, hp: 0, oreYield: 0, opaque: false,
    color: '#fbbf24', texture: 'energy',
  }),
  [Tile.STRUCTURE]: def({
    id: Tile.STRUCTURE, name: '건축물',
    solid: true, mineable: true, hp: 1, oreYield: 0, opaque: true,
    color: '#9aa4b2', texture: 'flat',
  }),
};

export const tileDef = (id: TileId): TileDef => TILES[id];
export const isSolid = (id: TileId): boolean => TILES[id].solid;
export const isMineable = (id: TileId): boolean => TILES[id].mineable;
export const isOpaque = (id: TileId): boolean => TILES[id].opaque;

/**
 * 팔 수 있는 타일은 전부 따뜻한 색이어야 한다는 규칙을 코드로 남긴다.
 * 새 타일을 추가할 때 이 함수가 테스트에서 걸러 준다.
 */
export const looksDiggable = (def: TileDef): boolean => {
  const v = parseInt(def.color.slice(1), 16);
  const r = (v >> 16) & 255, b = v & 255;
  return r > b;
};
