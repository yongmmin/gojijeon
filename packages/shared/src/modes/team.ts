/** 팀전: 상대 코어를 부수면 즉시 승리. 죽어도 8초 뒤 기지에서 부활한다. */
import { OUTPOST, TICK_HZ } from '../config/balance.js';
import { damageCore } from '../sim/damage.js';
import { ModeId, type TeamId, type World } from '../types.js';
import type { GameMode, RoundOutcome } from './mode.js';

export const TEAM_COUNT = 2;

export const teamMode: GameMode = {
  id: ModeId.TEAM,
  name: '팀전',
  blurb: '고지를 잡고 있으면 상대 코어가 깎인다. 직접 부수러 가도 된다.',
  spawnCount: TEAM_COUNT,

  assignTeam: (w) => {
    const counts = [0, 0];
    for (const p of w.players.values()) if (p.team === 0 || p.team === 1) counts[p.team]++;
    return counts[0] <= counts[1] ? 0 : 1;
  },

  onRoundStart: (w) => {
    for (const c of w.cores) c.hp = c.maxHp;
  },

  allowsRespawn: () => true,

  /**
   * 고지를 들고 있는 팀이 상대 코어를 갉아먹는다. 이게 "고지전"을 이름이
   * 아니라 규칙으로 만드는 한 줄이다 — 중앙을 오래 잡을수록 이긴다.
   *
   * 초당 한 번만 처리한다. 매 틱 깎으면 코어 피격 이벤트가 20Hz로 쏟아져
   * 화면이 비명을 지른다.
   */
  onTick: (w) => {
    const owner = w.outpost.owner;
    if (owner === null || w.tick % TICK_HZ !== 0) return;
    const enemy = w.cores.find((c) => c.team !== owner && c.hp > 0);
    if (enemy) damageCore(w, enemy, OUTPOST.coreDrainPerTick * TICK_HZ);
  },

  checkRoundEnd: (w) => {
    const dead = w.cores.filter((c) => c.hp <= 0);
    if (dead.length === 0) return null;
    // 코어가 동시에 터지는 일은 사실상 없지만, 그래도 규칙을 정해 둔다.
    if (dead.length >= w.cores.length) return { winner: null };
    const loser = dead[0].team;
    const winner = w.cores.find((c) => c.team !== loser)?.team ?? null;
    return { winner };
  },

  onTimeUp: (w): RoundOutcome => {
    // 시간 초과는 코어 체력 비율로 가른다. "못 부쉈지만 더 깎았다"를 인정한다.
    let best: TeamId | null = null;
    let bestRatio = Infinity;
    let tie = false;
    for (const c of w.cores) {
      const ratio = c.hp / c.maxHp;
      if (ratio < bestRatio) { bestRatio = ratio; best = c.team; tie = false; }
      else if (ratio === bestRatio) tie = true;
    }
    // 가장 많이 깎인 코어의 주인이 진다.
    if (tie || best === null) return { winner: null };
    const winner = w.cores.find((c) => c.team !== best)?.team ?? null;
    return { winner };
  },
};
