/**
 * 게임 모드 계약.
 *
 * 승패·팀 배정·부활 정책은 전부 모드가 소유한다. 시뮬레이션 코어에는
 * `if (mode === 'ffa')` 같은 분기가 한 줄도 없어야 한다. 새 모드를 추가하는 일이
 * 기존 모드를 건드리지 않게 만드는 유일한 방법이다.
 */
import type { ModeId, TeamId, World } from '../types.js';

export interface RoundOutcome {
  /** null이면 무승부(시간 초과 등). */
  winner: TeamId | null;
}

export interface GameMode {
  readonly id: ModeId;
  readonly name: string;
  readonly blurb: string;
  /** 맵에 필요한 스폰 지점 수. */
  readonly spawnCount: number;

  /** 새로 들어온 플레이어에게 팀을 준다. */
  assignTeam(w: World, playerId: number): TeamId;

  /** 라운드가 시작될 때(준비 페이즈 진입) 1회. */
  onRoundStart(w: World): void;

  /** 사망자를 다시 살릴 것인가. false면 라운드가 끝날 때까지 관전. */
  allowsRespawn(w: World): boolean;

  /**
   * 전투 페이즈 매 틱. 모드가 고지 보유를 자기 방식으로 승리에 연결한다.
   * 시뮬레이션 코어는 "누가 고지를 들고 있는가"까지만 알고, 그게 무슨 뜻인지는
   * 모른다 — 새 모드가 기존 모드를 건드리지 않게 하는 경계가 여기다.
   */
  onTick?(w: World): void;

  /** 라운드 종료 여부. 아직이면 null. */
  checkRoundEnd(w: World): RoundOutcome | null;

  /** 전투 시간이 다 됐을 때의 판정. */
  onTimeUp(w: World): RoundOutcome;
}
