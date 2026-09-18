/**
 * "컴퓨터 3명"이 2대2인지 4인 개인전인지 말해 주는 한 줄.
 *
 * 이 문장이 없으면 스테퍼의 숫자는 아무 뜻이 없다. 팀 배분은 서버의
 * assignTeam이 하는 일(양쪽을 같게 유지)을 그대로 계산한 것이다 —
 * 서버가 배분 규칙을 바꾸면 이 함수도 같이 고쳐야 한다.
 */
import { MODES, ModeId } from '@gojijeon/shared';

export interface Lineup {
  /** 화면에 그대로 쓰는 문장. */
  readonly text: string;
}

/** @param humans 봇을 뺀 사람 수. 싱글은 나 하나, 대기실은 방에 있는 사람 전부다. */
export const lineup = (mode: ModeId, bots: number, humans = 1): Lineup => {
  const total = humans + bots;
  const solo = humans <= 1;
  const who = solo ? `나 + 컴퓨터 ${bots}명` : `사람 ${humans}명 + 컴퓨터 ${bots}명`;

  if (mode !== ModeId.TEAM) {
    return { text: `${who} · ${total}인 ${MODES[ModeId.FFA].name}` };
  }

  // 서버가 번갈아 배정하므로 양쪽이 반씩 된다. 내가 먼저 들어간 쪽이 많은 쪽이다.
  const mine = Math.ceil(total / 2);
  const theirs = total - mine;
  if (!solo) return { text: `${who} · ${mine}대${theirs}` };

  const allies = mine - 1;
  const side = allies === 0 ? '나 혼자' : `나와 컴퓨터 ${allies}명`;
  return { text: `${side} 대 컴퓨터 ${theirs}명 · ${mine}대${theirs}` };
};
