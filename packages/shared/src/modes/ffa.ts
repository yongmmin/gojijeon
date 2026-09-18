/**
 * 개인전: 전원이 적. 고지를 더 오래 잡은 사람이 라운드를 가져간다.
 *
 * 예전에는 "마지막 생존자"였다. 고지전이 된 뒤로는 맞지 않는다 —
 * 죽어도 부활하고, 이기는 길이 상대를 전멸시키는 것이 아니라 중앙을
 * 오래 밟고 서 있는 것이기 때문이다. 싸움은 목적이 아니라 고지에서
 * 상대를 밀어내기 위한 수단이 된다.
 */
import { MATCH, OUTPOST } from '../config/balance.js';
import { leadingHolder } from '../sim/outpost.js';
import { ModeId, type TeamId, type World } from '../types.js';
import type { GameMode, RoundOutcome } from './mode.js';

export const ffaMode: GameMode = {
  id: ModeId.FFA,
  name: '자유 대전',
  blurb: '전원이 적. 고지를 가장 오래 지킨 사람이 라운드를 가져간다.',
  spawnCount: MATCH.maxPlayers,

  // FFA에서는 플레이어마다 고유한 팀 번호를 준다. 그러면 "같은 팀이 아니면 적"
  // 규칙 하나로 전투 코드가 그대로 돌아간다.
  //
  // 번호는 반드시 [0, spawnCount) 안에서 골라야 한다. 맵의 기지에도 같은 번호가
  // 붙어 있어서, 범위를 벗어나면 그 사람만 집이 없는 채로 경기를 한다.
  assignTeam: (w) => {
    const used = new Set<TeamId>();
    for (const p of w.players.values()) used.add(p.team);
    for (let i = 0; i < MATCH.maxPlayers; i++) if (!used.has(i)) return i;
    return 0;
  },

  onRoundStart: () => {},

  // 고지를 잡는 게 목표이므로 죽음은 퇴장이 아니라 지연이다.
  allowsRespawn: () => true,

  checkRoundEnd: (w) => {
    for (const [team, ticks] of Object.entries(w.holdTicks)) {
      if (ticks >= OUTPOST.holdToWinTicks) return { winner: Number(team) };
    }
    return null;
  },

  onTimeUp: (w): RoundOutcome => ({ winner: leadingHolder(w) }),
};
