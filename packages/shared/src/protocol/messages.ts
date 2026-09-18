/**
 * 와이어 프로토콜.
 *
 * v1은 JSON이다. LAN에서 8인 20Hz면 대역폭이 문제가 되지 않고, 디버깅이
 * 압도적으로 쉽다. 다만 인코딩은 codec.ts 한 곳에만 있어서, 나중에 바이너리로
 * 바꿔도 이 파일의 타입은 그대로 남는다.
 */
import type { StructureId } from '../buildings.js';
import type { PlayerAction } from '../sim/actions.js';
import type { WeaponId } from '../weapons.js';
import type {
  DropKind, GameEvent, ModeId, Phase, PlayerId, TeamId,
} from '../types.js';

/**
 * 방 코드.
 *
 * 헷갈리는 글자(0/O, 1/I/L)를 뺀 4자. 옆자리 사람에게 말로 불러 주는 것이
 * 주된 전달 수단이라, 받아 적다 틀릴 여지를 없애는 쪽이 짧은 것보다 중요하다.
 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 4;

export const normalizeRoomCode = (raw: string): string =>
  raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH);

export const isRoomCode = (raw: string): boolean =>
  raw.length === ROOM_CODE_LENGTH && [...raw].every((c) => ROOM_CODE_ALPHABET.includes(c));

// ── 클라이언트 → 서버 ────────────────────────────────────────────────────────

export type ClientMessage =
  /** 새 방을 연다. 만든 사람이 호스트가 된다. */
  | {
      t: 'create';
      name: string;
      token: string | null;
      mode: ModeId;
      /** 싱글이면 나 말고 전부 컴퓨터이고, 코드로 남이 들어올 수 없다. */
      single: boolean;
      bots: number;
    }
  /** 코드로 기존 방에 들어간다. token이 그 방의 것이면 원래 자리로 복귀한다. */
  | { t: 'join'; name: string; token: string | null; code: string }
  /** 방에서 나간다. 서버는 'left'로 답하고 클라는 메뉴로 돌아간다. */
  | { t: 'leave' }
  | { t: 'input'; seq: number; mx: number; my: number; aim: number; buttons: number }
  | { t: 'action'; action: PlayerAction }
  /** 호스트만. 로비에서만 받는다. */
  | { t: 'setMode'; mode: ModeId }
  | { t: 'setBots'; count: number }
  | { t: 'startMatch' }
  | { t: 'ready'; ready: boolean }
  | { t: 'chat'; text: string }
  | { t: 'pong'; id: number };

// ── 서버 → 클라이언트 ────────────────────────────────────────────────────────

export interface RoomInfo {
  code: string;
  single: boolean;
  mode: ModeId;
  /** 모드·봇 수 변경과 시작은 호스트만 할 수 있다. 버튼을 누가 누를지 헷갈리지 않게. */
  hostId: PlayerId;
  /** 사람 + 봇을 합친 정원. */
  capacity: number;
  bots: number;
}

export interface NetPlayer {
  id: PlayerId;
  name: string;
  team: TeamId;
  x: number;
  y: number;
  aim: number;
  hp: number;
  alive: boolean;
  weapon: WeaponId | null;
  /** 휘두르는 중이면 판정까지 남은 틱. 0이면 대기. */
  swing: number;
  ore: number;
  shard: number;
  kills: number;
  deaths: number;
  connected: boolean;
  spectating: boolean;
  /** 굴착 중인 타일. 없으면 -1. */
  mining: number;
  /** 부활까지 남은 틱. 살아 있거나 부활이 없는 모드면 0. */
  respawnIn: number;
  bot: boolean;
}

export interface NetProjectile {
  id: number; x: number; y: number; vx: number; vy: number; r: number; team: TeamId;
  /** 나온 무기. 포탑 탄처럼 무기가 아닌 출처는 null. */
  weapon: WeaponId | null;
}

export interface NetDrop {
  id: number; kind: DropKind; weapon: WeaponId | null; amount: number; x: number; y: number;
}

export interface NetStructure {
  tile: number; type: StructureId; team: TeamId; hp: number; maxHp: number;
}

export interface NetOutpost {
  tx: number;
  ty: number;
  owner: TeamId | null;
  capturing: TeamId | null;
  /** 0~1. */
  progress: number;
  contested: boolean;
  /** 점령 판정 반경(px). 클라가 원을 그릴 때 쓴다. */
  radius: number;
  /** 팀별 누적 점령 시간(틱). */
  hold: Record<string, number>;
  /** 개인전에서 승리에 필요한 누적 점령 시간(틱). 0이면 승리 조건이 아님. */
  holdToWin: number;
}

/**
 * 순위 한 줄. 정렬은 서버가 끝내서 보낸다 — 클라가 다시 줄 세우면
 * 정렬 기준이 승리 조건과 조용히 어긋날 수 있다.
 */
export interface NetStanding {
  team: TeamId;
  /** 이 팀의 플레이어. 클라가 이름을 붙이고 "나"를 찾는 데 쓴다. */
  members: PlayerId[];
  /** 라운드 승수. */
  score: number;
  /** 누적 점령 시간(틱). */
  hold: number;
  kills: number;
  deaths: number;
  alive: number;
}

/** 붕괴 구역. 클라가 경계 원과 경고를 그린다. */
export interface NetZone {
  x: number;
  y: number;
  radius: number;
  /** 지금 좁아지는 중인가. 멈춰 있을 때와 다르게 그리라는 뜻. */
  shrinking: boolean;
}

export interface NetCore {
  team: TeamId; tx: number; ty: number; hp: number; maxHp: number;
}

export interface Snapshot {
  tick: number;
  phase: Phase;
  phaseEndTick: number;
  round: number;
  score: Record<string, number>;
  players: NetPlayer[];
  projectiles: NetProjectile[];
  drops: NetDrop[];
  cores: NetCore[];
  outpost: NetOutpost;
  zone: NetZone;
  /** 이미 정렬된 순위표. 1위가 앞. */
  standings: NetStanding[];
  /** 매치를 가져가는 데 필요한 라운드 승수. */
  roundsToWin: number;
  /** 라운드 사이 정산 시간(틱). 클라가 "다음 라운드까지" 카운트다운에 쓴다. */
  intermissionTicks: number;
  /** 이번 틱에 바뀐 타일: [인덱스, 타일id, 남은 hp] 3개씩 평평하게. */
  tileDelta: number[];
  /** 이번 틱에 생기거나 사라진 건축물. */
  structAdd: NetStructure[];
  structRemove: number[];
  events: GameEvent[];
  /** 서버가 마지막으로 처리한 이 클라의 입력 번호. */
  ack: number;
}

export interface LobbyPlayer {
  id: PlayerId;
  name: string;
  team: TeamId;
  ready: boolean;
  connected: boolean;
  bot: boolean;
}

export type ServerMessage =
  | {
      t: 'welcome';
      you: PlayerId;
      token: string;
      room: RoomInfo;
      seed: number;
      mapTiles: number;
      tileSize: number;
      /** RLE+base64로 압축된 전체 타일. */
      tiles: string;
      structures: NetStructure[];
      snapshot: Snapshot;
    }
  /** 라운드가 새로 시작돼 지형이 통째로 바뀌었을 때. */
  | { t: 'reset'; round: number; tiles: string; structures: NetStructure[] }
  | { t: 'snapshot'; s: Snapshot }
  | { t: 'lobby'; room: RoomInfo; players: LobbyPlayer[]; canStart: boolean }
  | { t: 'denied'; reason: string }
  /** 방을 떠났다. reason이 있으면 쫓겨난 것(방 해산 등). */
  | { t: 'left'; reason: string | null }
  | { t: 'ping'; id: number };
