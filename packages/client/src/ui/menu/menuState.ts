/**
 * 메뉴 흐름의 상태.
 *
 * 씬은 프레임마다 다시 만들어질 수 있으므로(게임 → 메뉴 복귀) 이 객체는 씬 밖에서 산다.
 * 여기에는 통신이 없다 — 어느 단계에 있고 무엇을 고르는 중인지만 기억한다.
 */
import { MATCH, ModeId, isRoomCode, normalizeRoomCode } from '@gojijeon/shared';
import { loadName, loadRoomCode } from '../../net/session';
import { STEP_BACK, type MenuStep } from './menuTypes';

/** 봇은 최소 1, 최대 정원-1(나 한 명은 사람이므로). */
export const BOTS_MIN = 1;
export const BOTS_MAX = MATCH.maxPlayers - 1;
export const BOTS_DEFAULT = 3;

export class MenuState {
  step: MenuStep = 'name';
  name = '';
  mode: ModeId = ModeId.FFA;
  bots = BOTS_DEFAULT;
  code = '';
  notice: string | null = null;
  /** 서버 응답 대기 중. 버튼을 잠그고 "…중" 문구를 띄운다. */
  pending = false;
  /**
   * 링크(?code=)로 들어왔는데 이름이 없어 1단계에 선 상태.
   * 멀티를 고르는 순간 한 번만 코드 입력으로 건너뛴다 — 계속 켜 두면 '뒤로'가 갇힌다.
   */
  linkShortcut = false;
  /** 요청이 거부되면 돌아갈 단계. 사유를 그 자리에 붙이기 위해 기억해 둔다. */
  private returnStep: MenuStep = 'name';

  goto(step: MenuStep): void {
    this.step = step;
    this.notice = null;
  }

  back(): void {
    const prev = STEP_BACK[this.step];
    if (prev) this.goto(prev);
  }

  /** 서버에 요청을 보냈다. 응답(welcome/denied)이 올 때까지 잠근다. */
  begin(): void {
    this.returnStep = this.step;
    this.pending = true;
    this.notice = null;
  }

  /** 거부당했다. 요청을 낸 단계로 되돌리고 사유를 그 자리에 남긴다. */
  fail(reason: string | null): void {
    this.pending = false;
    this.step = this.returnStep === 'room' ? 'name' : this.returnStep;
    this.notice = reason;
  }

  /** 방을 떠났다(내가 눌렀거나 방이 해산됐거나). 1단계로. */
  toStart(reason: string | null): void {
    this.pending = false;
    this.step = 'name';
    this.returnStep = 'name';
    this.notice = reason;
  }

  setCode(raw: string): void {
    this.code = normalizeRoomCode(raw);
  }

  get codeReady(): boolean {
    return isRoomCode(this.code);
  }

  get nameReady(): boolean {
    return this.name.trim().length > 0;
  }
}

/** URL의 ?code=ABCD. 옆자리에서 링크로 부를 때 쓰는 유일한 경로다. */
const codeFromUrl = (): string => {
  try {
    return normalizeRoomCode(new URLSearchParams(location.search).get('code') ?? '');
  } catch {
    return '';
  }
};

export interface MenuBoot {
  state: MenuState;
  /** 새로고침 복귀. 여기 코드가 있으면 씬이 붙자마자 join을 한 번 시도한다. */
  autoJoinCode: string | null;
}

/**
 * 첫 화면을 정한다.
 * 링크(?code=)가 있으면 그쪽이 우선이고, 없으면 마지막에 있던 방으로 조용히 복귀를 시도한다.
 */
export const bootMenu = (): MenuBoot => {
  const state = new MenuState();
  state.name = loadName() ?? '';

  const linked = codeFromUrl();
  if (isRoomCode(linked)) {
    state.code = linked;
    // 이름을 모르면 코드만 쥔 채 1단계에 세운다 — 멀티로 넘어가면 그 코드가 그대로 따라간다.
    state.step = state.nameReady ? 'join' : 'name';
    state.linkShortcut = !state.nameReady;
    return { state, autoJoinCode: null };
  }

  const saved = loadRoomCode() ?? '';
  if (isRoomCode(saved) && state.nameReady) {
    state.code = saved;
    state.pending = true;
    return { state, autoJoinCode: saved };
  }
  return { state, autoJoinCode: null };
};

/** 대기실에서 보여 주는 공유용 주소. */
export const shareUrl = (code: string): string => `${location.origin}/?code=${code}`;
