/**
 * 팀 번호 → 화면에 쓸 이름.
 *
 * 개인전에서는 팀 번호가 곧 사람 한 명이라 "3팀"은 아무 뜻이 없다. 그 번호를 가진
 * 플레이어의 이름으로 바꾼다. 팀전은 팀이 진짜 여럿이므로 "1팀" 그대로 쓴다.
 *
 * 고지 배너·누적 점령 시간 막대·점령 이벤트가 **같은 함수**를 쓴다 —
 * 세 곳이 서로 다른 말을 하면 누가 먹고 있는지 읽는 데 두 번 생각해야 한다.
 */
import { ModeId } from '@gojijeon/shared';
import type { ClientWorld } from '../net/clientWorld';

export const teamLabel = (world: ClientWorld, team: number): string => {
  if (world.mode === ModeId.TEAM) return `${team}팀`;

  const me = world.me;
  if (me && me.team === team) return '나';

  const owner = world.snapshot?.players.find((p) => p.team === team);
  // 이미 나간 사람의 팀 번호가 남아 있을 수 있다. 그때만 번호로 떨어진다.
  return owner ? owner.name : `${team}팀`;
};
