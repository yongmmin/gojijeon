/**
 * 건축물 레지스트리.
 *
 * 건축물은 타일 한 칸을 점유한다(Tile.STRUCTURE). 칸 자체의 부가 정보(HP, 소유 팀,
 * 쿨다운)는 World.structures에 따로 산다. 새 건물 추가 = 아래 표에 항목 하나.
 *
 * 광석으로 사는 것은 벽·문·화톳불까지다. 포탑만이 코어 조각을 요구하고,
 * 조각은 적을 죽이거나 맵 중앙을 점령해야 나온다. 건설 트리의 꼭대기에
 * 일부러 "싸워야만 닿는" 문턱을 하나 둔 것이다.
 */
import { TILE, secs } from './config/balance.js';

export const StructureId = {
  WALL: 'wall',
  DOOR: 'door',
  CAMPFIRE: 'campfire',
  TURRET: 'turret',
} as const;

export type StructureId = (typeof StructureId)[keyof typeof StructureId];

export interface StructureDef {
  readonly id: StructureId;
  readonly name: string;
  readonly cost: { readonly ore: number; readonly shard: number };
  readonly hp: number;
  /** 적에게 막히는가. 문은 아군만 통과시키므로 여기서는 true, 통행 판정에서 팀을 본다. */
  readonly solid: boolean;
  /** 아군은 통과할 수 있는가(문). */
  readonly friendlyPassable: boolean;
  readonly opaque: boolean;
  /** 주기적으로 무언가 하는 건물의 주기. 없으면 0. */
  readonly intervalTicks: number;
  /** 화톳불: 반경 내 아군 회복량(틱당 적용, intervalTicks마다). */
  readonly heal: { readonly radius: number; readonly amount: number } | null;
  /** 포탑. */
  readonly turret: {
    readonly range: number;
    readonly damage: number;
    readonly projectileSpeed: number;
  } | null;
  readonly color: string;
  readonly blurb: string;
}

const base = {
  solid: true,
  friendlyPassable: false,
  opaque: true,
  intervalTicks: 0,
  heal: null,
  turret: null,
} satisfies Partial<StructureDef>;

const def = (
  d: Partial<StructureDef> & Pick<StructureDef, 'id' | 'name' | 'cost' | 'hp' | 'color' | 'blurb'>,
): StructureDef => ({ ...base, ...d }) as StructureDef;

export const STRUCTURES: Readonly<Record<StructureId, StructureDef>> = {
  [StructureId.WALL]: def({
    id: StructureId.WALL, name: '벽', cost: { ore: 10, shard: 0 }, hp: 60,
    color: '#8d99ae',
    blurb: '통로를 막는다. 가장 싸고 가장 많이 쓴다.',
  }),
  [StructureId.DOOR]: def({
    id: StructureId.DOOR, name: '문', cost: { ore: 15, shard: 0 }, hp: 45,
    friendlyPassable: true, opaque: false,
    color: '#b08968',
    blurb: '아군만 통과한다. 기지 입구에 꼭 하나는 필요하다.',
  }),
  [StructureId.CAMPFIRE]: def({
    id: StructureId.CAMPFIRE, name: '화톳불', cost: { ore: 30, shard: 0 }, hp: 40,
    solid: false, opaque: false,
    intervalTicks: secs(1),
    heal: { radius: TILE * 3, amount: 6 },
    color: '#f97316',
    blurb: '주변 아군을 천천히 회복시킨다. 전선 유지의 핵심.',
  }),
  [StructureId.TURRET]: def({
    id: StructureId.TURRET, name: '포탑', cost: { ore: 120, shard: 3 }, hp: 220,
    intervalTicks: secs(0.9),
    turret: { range: TILE * 9, damage: 22, projectileSpeed: 560 },
    color: '#ef4444',
    blurb: '한 판에 하나 세울까 말까 한 물건. 조각이 들어가므로 죽이거나 중앙을 먹어야 손에 넣는다.',
  }),
};

export const structureDef = (id: StructureId): StructureDef => STRUCTURES[id];
export const BUILDABLE: readonly StructureId[] = Object.values(StructureId);
