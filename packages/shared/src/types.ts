/** 시뮬레이션 상태의 모양. 서버가 소유하고, 클라는 읽기 전용 사본을 받는다. */
import type { StructureId } from './buildings.js';
import type { TileId } from './tiles.js';
import type { WeaponId } from './weapons.js';

export type PlayerId = number;
/** 0은 무소속(FFA에서는 플레이어마다 고유 팀 번호를 준다). */
export type TeamId = number;

export const Phase = {
  LOBBY: 'lobby',
  PREP: 'prep',
  COMBAT: 'combat',
  ROUND_END: 'roundEnd',
  MATCH_END: 'matchEnd',
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

export const ModeId = { FFA: 'ffa', TEAM: 'team' } as const;
export type ModeId = (typeof ModeId)[keyof typeof ModeId];

/** 클라가 매 틱 보내는 것. 이게 전부다 — 상태는 절대 클라가 정하지 않는다. */
export interface InputState {
  seq: number;
  /** -1..1 정규화된 이동 의도. */
  mx: number;
  my: number;
  /** 조준 각(radian). */
  aim: number;
  /** Button 비트마스크. */
  buttons: number;
}

export const Button = {
  PRIMARY: 1 << 0,   // 공격 / 채굴
  SECONDARY: 1 << 1, // 방어 자세 등 보조
  DROP: 1 << 2,      // 손에 든 것을 버린다
  INTERACT: 1 << 3,  // 줍기 / 제작대 열기
} as const;

export const emptyInput = (): InputState => ({ seq: 0, mx: 0, my: 0, aim: 0, buttons: 0 });

export interface Resources {
  ore: number;
  shard: number;
}

export interface Player {
  id: PlayerId;
  name: string;
  team: TeamId;
  x: number;
  y: number;
  /** 최근 이동 방향(렌더·넉백용). */
  vx: number;
  vy: number;
  aim: number;
  hp: number;
  alive: boolean;
  /** 손에 든 단 하나. 맨손이면 null. */
  weapon: WeaponId | null;
  res: Resources;
  /** 현재 휘두르는 중이면 판정이 일어날 틱. 아니면 0. */
  swingHitTick: number;
  /** 다음 행동이 가능해지는 틱. */
  readyTick: number;
  /** 무적이 풀리는 틱. */
  invulnUntilTick: number;
  /** 사망 시 부활 가능해지는 틱. */
  respawnTick: number;
  /** 굴착 대상 타일 인덱스(연속 채굴 표시용). -1이면 없음. */
  miningTile: number;
  /** 라운드 통계. */
  kills: number;
  deaths: number;
  /** 접속 상태. 끊겨도 유예 시간 동안 슬롯이 남는다. 봇은 항상 true. */
  connected: boolean;
  /** 컴퓨터가 조종하는가. 서버만 쓰는 값이지만 클라도 표시에 쓴다. */
  bot: boolean;
  /** 관전 중인가(죽어서 라운드 아웃됐거나, 라운드 도중 합류). */
  spectating: boolean;
  input: InputState;
  /** 직전 틱의 버튼 상태. 누르는 순간만 반응하는 동작(버리기 등)에 쓴다. */
  lastButtons: number;
}

export interface Projectile {
  id: number;
  owner: PlayerId;
  team: TeamId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  tileDamage: number;
  dieTick: number;
  /**
   * 어느 무기에서 나왔는가. 포탑 탄처럼 무기가 아닌 출처는 null.
   * 클라가 그림을 고르는 근거이기도 하다 — 속도와 크기로 종류를 추측하게
   * 두면 무기를 하나 추가할 때마다 렌더 쪽 추측이 틀어진다.
   */
  weapon: WeaponId | null;
  /** 폭탄처럼 터지는 투사체는 여기에 무기 id가 담긴다. */
  explodesAs: WeaponId | null;
}

export type DropKind = 'weapon' | 'ore' | 'shard' | 'health';

export interface Drop {
  id: number;
  kind: DropKind;
  /** kind가 weapon일 때만. */
  weapon: WeaponId | null;
  amount: number;
  x: number;
  y: number;
  dieTick: number;
  /** 이 틱 전에는 주울 수 없다(자기가 버린 걸 바로 다시 줍는 것 방지). */
  pickupTick: number;
}

export interface Structure {
  /** 점유한 타일 인덱스. 그대로 키로 쓴다. */
  tile: number;
  type: StructureId;
  team: TeamId;
  owner: PlayerId;
  hp: number;
  maxHp: number;
  /** 주기 동작(회복·사격)의 다음 발동 틱. */
  nextActTick: number;
}

/**
 * 맵 한가운데의 점령 목표.
 *
 * `progress`는 항상 `capturing` 팀의 진행도다. 다른 팀이 올라서면 0으로 되돌리고
 * 그 팀의 시계가 처음부터 간다 — "10초 서 있으면 내 것"이 소유주가 있든 없든
 * 똑같이 성립해야 규칙을 한 문장으로 설명할 수 있다.
 */
export interface Outpost {
  tx: number;
  ty: number;
  /** 점령 시 포탑이 서는 칸. 맵 생성 때 정해 둔다. */
  turretTx: number;
  turretTy: number;
  owner: TeamId | null;
  /** 지금 시계를 돌리고 있는 팀. */
  capturing: TeamId | null;
  /** 0~1. */
  progress: number;
  /** 둘 이상의 팀이 함께 서 있어 멈춘 상태. */
  contested: boolean;
}

/** 팀전에서만 존재하는 승패 목표물. */
export interface Core {
  team: TeamId;
  tx: number;
  ty: number;
  hp: number;
  maxHp: number;
}

export interface World {
  tick: number;
  /** 이 판의 준비 페이즈 길이(틱). 싱글은 짧다. */
  prepTicks: number;
  seed: number;
  mode: ModeId;
  phase: Phase;
  /** 현재 페이즈가 끝나는 틱. */
  phaseEndTick: number;
  round: number;
  /** 팀별 라운드 승수. */
  score: Record<TeamId, number>;

  tiles: Uint8Array;
  /** 굴착 진행도. 타일 정의 hp에서 깎여 내려간다. */
  tileHp: Uint16Array;

  players: Map<PlayerId, Player>;
  structures: Map<number, Structure>;
  cores: Core[];
  outpost: Outpost;
  /** 팀별 누적 점령 시간(틱). 개인전의 승리 조건이자 모든 모드의 전황 지표. */
  holdTicks: Record<TeamId, number>;
  projectiles: Projectile[];
  drops: Drop[];
  /** 코어 조각 노드 타일 인덱스 → 다음 생산 틱. */
  shardNodes: Map<number, number>;
  /** 준비 페이즈 봉쇄벽 타일들. 전투 시작 시 한꺼번에 무너뜨린다. */
  barrierTiles: number[];

  spawns: Array<{ team: TeamId; x: number; y: number }>;

  /** 이번 틱에 바뀐 타일 인덱스. 스냅샷에 실어 보내고 매 틱 비운다. */
  dirtyTiles: Set<number>;

  nextEntityId: number;
  /** 이 틱에 발생한 일들. 스냅샷과 함께 보내고 매 틱 비운다. */
  events: GameEvent[];
}

export type GameEvent =
  | { t: 'hit'; x: number; y: number; dmg: number; target: PlayerId; by: PlayerId }
  | { t: 'blocked'; x: number; y: number; target: PlayerId }
  | { t: 'death'; id: PlayerId; by: PlayerId; weapon: WeaponId | null }
  | { t: 'spawn'; id: PlayerId }
  | { t: 'tileBroken'; tile: number; was: TileId }
  | { t: 'build'; tile: number; type: StructureId; team: TeamId }
  | { t: 'structureDown'; tile: number }
  | { t: 'explosion'; x: number; y: number; radius: number }
  | { t: 'loot'; x: number; y: number; weapon: WeaponId }
  | { t: 'bounty'; id: PlayerId; ore: number; shard: number }
  | { t: 'pickup'; id: PlayerId; kind: DropKind; weapon: WeaponId | null; amount: number }
  | { t: 'heal'; id: PlayerId; amount: number; x: number; y: number }
  | { t: 'coreHit'; team: TeamId; hp: number }
  | { t: 'capture'; team: TeamId; x: number; y: number }
  | { t: 'phase'; phase: Phase; endTick: number; round: number }
  | { t: 'roundEnd'; winner: TeamId | null }
  | { t: 'matchEnd'; winner: TeamId | null }
  | { t: 'chat'; id: PlayerId; text: string };
