/**
 * 메뉴가 주고받는 것들의 모양.
 *
 * 뷰는 여기 있는 모델만 읽고 핸들러만 부른다 — 소켓도 세션 저장소도 모른다.
 * 그래야 단계 하나를 추가하거나 빼도 통신 코드를 건드리지 않는다.
 */
import type { LobbyPlayer, ModeId, PlayerId, RoomInfo } from '@gojijeon/shared';

/**
 * 메뉴 단계.
 * name → (single | multi) → (multi는 create | join) → room
 */
export type MenuStep = 'name' | 'single' | 'multi' | 'create' | 'join' | 'room';

/** 각 단계의 '뒤로'가 가는 곳. 뒤로 가기를 버튼마다 따로 적지 않기 위한 표. */
export const STEP_BACK: Readonly<Record<MenuStep, MenuStep | null>> = {
  name: null,
  single: 'name',
  multi: 'name',
  create: 'multi',
  join: 'multi',
  room: null,
};

export interface MenuModel {
  step: MenuStep;
  name: string;
  /** 방을 만들기 전 로컬 선택값. 방에 들어간 뒤에는 room.mode가 진실이다. */
  mode: ModeId;
  bots: number;
  code: string;
  /** 거부 사유나 방 해산 안내. 단계 안에 그대로 붙는다. */
  notice: string | null;
  /** 서버 응답을 기다리는 중. 버튼을 잠근다. */
  pending: boolean;
  room: RoomInfo | null;
  players: readonly LobbyPlayer[];
  canStart: boolean;
  youId: PlayerId;
  isHost: boolean;
}

export interface MenuHandlers {
  onNameChange: (name: string) => void;
  onStep: (step: MenuStep) => void;
  /** 단계에 따라 로컬 선택이거나 호스트의 setMode다. 판단은 씬이 한다. */
  onMode: (mode: ModeId) => void;
  onBots: (count: number) => void;
  onCodeChange: (code: string) => void;
  onCreate: (single: boolean) => void;
  onJoin: () => void;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onLeave: () => void;
}
