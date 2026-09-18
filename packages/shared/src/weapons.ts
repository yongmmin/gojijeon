/**
 * 무기 레지스트리.
 *
 * 이 게임의 핵심 제약: 플레이어는 **손에 하나**만 든다. 인벤토리가 없다.
 * 다른 걸 들려면 지금 든 것을 바닥에 버려야 하고, 죽으면 자동으로 떨어진다.
 * 곡괭이도 이 슬롯을 먹기 때문에 "캐는 동안은 무방비"라는 긴장이 생긴다.
 *
 * **무기는 만들 수 없다. 땅에서 나온다.** 벽을 뚫으면 확률적으로 떨어지고,
 * 그걸 주우려면 지금 든 것을 놓아야 한다. 곡괭이를 버리고 단검을 들 것인가가
 * 매 발굴마다 반복되는 선택이고, 그게 이 게임의 리듬이다.
 *
 * 무기를 추가할 때는 아래 WEAPONS에 정의 하나를 더하면 끝이다. 드랍 표도
 * dropWeight에서 자동으로 만들어지므로, 새 무기는 넣는 즉시 땅에서 나온다.
 */
import { TICK_HZ, TILE, secs } from './config/balance.js';

export const WeaponId = {
  PICKAXE: 'pickaxe',
  DAGGER: 'dagger',
  SHURIKEN: 'shuriken',
  SPEAR: 'spear',
  BOW: 'bow',
  SHIELD: 'shield',
  HAMMER: 'hammer',
  BOMB: 'bomb',
} as const;

export type WeaponId = (typeof WeaponId)[keyof typeof WeaponId];

export type WeaponKind = 'melee' | 'ranged' | 'shield' | 'throwable';

export interface ProjectileSpec {
  readonly speed: number;
  readonly radius: number;
  readonly damage: number;
  readonly lifetimeTicks: number;
  /** 벽에 닿으면 흙벽에 입히는 피해. 0이면 그냥 소멸. */
  readonly tileDamage: number;
}

export interface ExplosionSpec {
  readonly radius: number;
  readonly damage: number;
  /** 폭심 타일 기준 파괴 반경(타일). */
  readonly tileRadius: number;
  readonly tileDamage: number;
  readonly fuseTicks: number;
}

export interface WeaponDef {
  readonly id: WeaponId;
  readonly name: string;
  readonly kind: WeaponKind;
  /**
   * 굴착 드랍 가중치. 0이면 땅에서 나오지 않는다.
   * 비율만 의미가 있고, 절대 확률은 balance.ts의 LOOT가 정한다.
   */
  readonly dropWeight: number;
  /** 귀함의 표시. 드랍 연출과 HUD 색 강조에만 쓴다. */
  readonly rarity: 'common' | 'uncommon' | 'rare';
  /** 근접 피해. ranged는 projectile 쪽 값을 쓴다. */
  readonly damage: number;
  /** 근접 사거리(px). */
  readonly range: number;
  /** 근접 판정 부채꼴의 반각(radian). */
  readonly halfArc: number;
  /** 휘두르기 시작 → 판정까지. 이 동안 움직임이 느려진다. */
  readonly windupTicks: number;
  /** 판정 → 다음 공격 가능까지. */
  readonly recoverTicks: number;
  /** 이동 속도 배수. */
  readonly speedMultiplier: number;
  /** 굴착 위력. 0이면 이 무기로는 땅을 팔 수 없다(느린 대체 경로만 남음). */
  readonly miningPower: number;
  /** 건설 가능 여부와 철거 위력. */
  readonly buildPower: number;
  /** 방패: 정면 피해 감소율(0~1)과 방어 반각. */
  readonly block: { readonly reduction: number; readonly halfArc: number } | null;
  readonly projectile: ProjectileSpec | null;
  readonly explosion: ExplosionSpec | null;
  /** 한 번 쓰면 사라지는가(폭탄). */
  readonly consumable: boolean;
  /** 바닥에 떨어졌을 때 / HUD에서 쓰는 색. */
  readonly color: string;
  readonly blurb: string;
}

const base = {
  dropWeight: 0,
  rarity: 'common',
  damage: 0,
  range: TILE * 1.4,
  halfArc: Math.PI / 5,
  windupTicks: secs(0.15),
  recoverTicks: secs(0.4),
  speedMultiplier: 1,
  miningPower: 0,
  buildPower: 0,
  block: null,
  projectile: null,
  explosion: null,
  consumable: false,
} satisfies Partial<WeaponDef>;

const def = (d: Partial<WeaponDef> & Pick<WeaponDef, 'id' | 'name' | 'kind' | 'color' | 'blurb'>): WeaponDef =>
  ({ ...base, ...d }) as WeaponDef;

export const WEAPONS: Readonly<Record<WeaponId, WeaponDef>> = {
  [WeaponId.PICKAXE]: def({
    id: WeaponId.PICKAXE, name: '곡괭이', kind: 'melee', color: '#9ca3af',
    blurb: '기본 지급. 땅을 파는 유일한 제대로 된 도구지만, 싸움에서는 가장 약하다.',
    // 5였다. 스무 번을 때려야 사람이 죽었고, 한 대에 체력의 5%라 화면에서는
    // 아무 일도 안 일어나는 것처럼 보였다 — 플레이테스터가 "때리는 게 없냐"고
    // 물었다. 여전히 제일 약한 무기여야 하지만, 맞았다는 건 보여야 한다.
    damage: 8, range: TILE * 1.3,
    windupTicks: secs(0.12), recoverTicks: secs(0.35),
    miningPower: 10, buildPower: 2,
  }),
  [WeaponId.DAGGER]: def({
    id: WeaponId.DAGGER, name: '단검', kind: 'melee', color: '#f87171',
    blurb: '짧고 빠르다. 붙으면 이기지만 거리를 벌리면 아무것도 못 한다. 흔했었지만 이제는 아니다.',
    dropWeight: 16, rarity: 'common',
    damage: 16, range: TILE * 1.1, halfArc: Math.PI / 4,
    windupTicks: secs(0.08), recoverTicks: secs(0.22),
    speedMultiplier: 1.15,
  }),
  [WeaponId.SHURIKEN]: def({
    id: WeaponId.SHURIKEN, name: '표창', kind: 'ranged', color: '#2dd4bf',
    blurb: '작게 자주 맞힌다. 활만큼 멀리 못 가지만 훨씬 빠르고, 붙어도 쏠 수 있다.',
    dropWeight: 18, rarity: 'common',
    // 활(12칸)과 근접(1~2칸) 사이를 메운다. 중거리에서 견제하는 자리.
    range: TILE * 7,
    windupTicks: secs(0.08), recoverTicks: secs(0.22),
    speedMultiplier: 1.05,
    projectile: { speed: 620, radius: 3, damage: 9, lifetimeTicks: secs(0.6), tileDamage: 2 },
  }),
  [WeaponId.SPEAR]: def({
    id: WeaponId.SPEAR, name: '창', kind: 'melee', color: '#fbbf24',
    blurb: '근접 중 가장 길다. 선딜이 길어 헛치면 그대로 얻어맞는다.',
    dropWeight: 13, rarity: 'uncommon',
    damage: 30, range: TILE * 2.3, halfArc: Math.PI / 9,
    windupTicks: secs(0.3), recoverTicks: secs(0.5),
    speedMultiplier: 0.95,
  }),
  [WeaponId.BOW]: def({
    id: WeaponId.BOW, name: '활', kind: 'ranged', color: '#a3e635',
    blurb: '통로 끝에서 일방적으로 때린다. 붙히면 무력하다.',
    dropWeight: 11, rarity: 'uncommon',
    range: TILE * 12,
    windupTicks: secs(0.35), recoverTicks: secs(0.45),
    speedMultiplier: 0.92,
    // 26 → 20, 화살 속도 640 → 560.
    //
    // 통로에서 일방적으로 때리는 무기라 위험을 감수하지 않고도 네 대면
    // 사람이 죽었다. 다섯 대로 늘리고 화살을 느리게 해, 트인 곳에서는
    // 피할 여지를 줬다. 좁은 통로에서 강한 것은 그대로 둔다 — 그게 이 무기다.
    projectile: { speed: 560, radius: 4, damage: 20, lifetimeTicks: secs(1.4), tileDamage: 3 },
  }),
  [WeaponId.SHIELD]: def({
    id: WeaponId.SHIELD, name: '방패', kind: 'shield', color: '#60a5fa',
    blurb: '공격이 없다. 대신 정면을 거의 무효화한다. 좁은 통로를 혼자 막는 역할.',
    dropWeight: 12, rarity: 'uncommon',
    damage: 4, range: TILE * 1.0,
    windupTicks: secs(0.1), recoverTicks: secs(0.7),
    speedMultiplier: 0.78,
    block: { reduction: 0.8, halfArc: Math.PI / 2.4 },
  }),
  [WeaponId.HAMMER]: def({
    id: WeaponId.HAMMER, name: '망치', kind: 'melee', color: '#c084fc',
    blurb: '짓고 부순다. 전투력은 낮지만 이게 없으면 기지가 없다.',
    dropWeight: 18, rarity: 'common',
    // 곡괭이를 올린 만큼 같이 올린다. 도구가 기본 지급품보다 약하면
    // 망치를 드는 이유가 건설밖에 안 남는다.
    damage: 15, range: TILE * 1.3,
    windupTicks: secs(0.25), recoverTicks: secs(0.5),
    speedMultiplier: 0.95,
    miningPower: 11, buildPower: 10,
  }),
  [WeaponId.BOMB]: def({
    id: WeaponId.BOMB, name: '폭탄', kind: 'throwable', color: '#fb923c',
    blurb: '벽을 통째로 지운다. 한 번 쓰면 사라지고, 던진 뒤 당신은 맨손이다.',
    dropWeight: 12, rarity: 'uncommon',
    range: TILE * 6,
    windupTicks: secs(0.3), recoverTicks: secs(0.6),
    speedMultiplier: 0.9,
    consumable: true,
    projectile: { speed: 300, radius: 6, damage: 0, lifetimeTicks: secs(1.2), tileDamage: 0 },
    explosion: { radius: TILE * 2.6, damage: 55, tileRadius: 1, tileDamage: 999, fuseTicks: secs(1.2) },
  }),
};

export const weaponDef = (id: WeaponId): WeaponDef => WEAPONS[id];

/** 한 번 휘두르는 데 걸리는 시간(초). 선딜 + 후딜. */
export const swingSeconds = (def: WeaponDef): number =>
  (def.windupTicks + def.recoverTicks) / TICK_HZ;

/**
 * 초당 지형 피해량. 굴착 속도를 무기끼리 비교할 수 있는 유일한 척도다.
 *
 * 한 번 칠 때의 위력만 보면 안 된다. 단검은 위력이 낮아도 곡괭이의 절반
 * 시간에 휘두르므로, 위력에만 배수를 곱하면 "곡괭이보다 별로 안 느린 단검"이
 * 나와서 곡괭이를 들 이유가 사라진다.
 */
export const tileDps = (def: WeaponDef): number => def.miningPower / swingSeconds(def);

export const STARTING_WEAPON: WeaponId = WeaponId.PICKAXE;

/** 땅에서 나올 수 있는 것들. dropWeight가 0인 무기는 여기 없다. */
export const LOOT_POOL: readonly WeaponDef[] = (Object.values(WEAPONS) as WeaponDef[])
  .filter((w) => w.dropWeight > 0);

const LOOT_TOTAL = LOOT_POOL.reduce((n, w) => n + w.dropWeight, 0);

/**
 * 가중치 추첨. `roll`은 [0, 1) — 호출자가 난수를 넘기므로 이 함수 자체는 순수하고
 * 테스트에서 특정 무기를 지목해 뽑을 수 있다.
 */
export const rollWeapon = (roll: number): WeaponId => {
  let acc = roll * LOOT_TOTAL;
  for (const w of LOOT_POOL) {
    acc -= w.dropWeight;
    if (acc < 0) return w.id;
  }
  return LOOT_POOL[LOOT_POOL.length - 1].id;
};

/** 표를 사람이 읽을 수 있는 형태로. HUD의 도움말이 이걸 그대로 쓴다. */
export const lootOdds = (): Array<{ id: WeaponId; percent: number }> =>
  LOOT_POOL.map((w) => ({ id: w.id, percent: (w.dropWeight / LOOT_TOTAL) * 100 }));
