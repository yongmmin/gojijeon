/**
 * 순위.
 *
 * 누가 이기고 있는지는 **규칙**이므로 서버가 정한다. 클라가 스냅샷을 보고
 * 다시 유추하게 두면, 정렬 기준이 승리 조건과 조용히 어긋나는 날이 온다
 * (예: 킬 순으로 줄 세워 놓고 실제로는 점령 시간으로 이기는 화면).
 *
 * 정렬 기준은 한 줄로 설명할 수 있어야 한다:
 *   **라운드 승수 → 누적 점령 시간 → 처치 → 적게 죽은 순.**
 *
 * 두 모드가 같은 기준을 쓴다. 팀전은 코어를 깎아 이기지만 그것도 결국
 * 고지를 얼마나 오래 들고 있었느냐로 수렴하므로, 따로 가를 이유가 없다.
 */
import type { PlayerId, TeamId, World } from '../types.js';

export interface Standing {
  team: TeamId;
  /** 이 팀에 속한 플레이어. 클라가 이름을 붙이고 "나"를 찾는 데 쓴다. */
  members: PlayerId[];
  /** 라운드 승수. */
  score: number;
  /** 누적 점령 시간(틱). */
  hold: number;
  kills: number;
  deaths: number;
  /** 지금 살아 있는 인원. */
  alive: number;
}

export const standings = (w: World): Standing[] => {
  const byTeam = new Map<TeamId, Standing>();

  const slot = (team: TeamId): Standing => {
    let s = byTeam.get(team);
    if (!s) {
      s = { team, members: [], score: 0, hold: 0, kills: 0, deaths: 0, alive: 0 };
      byTeam.set(team, s);
    }
    return s;
  };

  for (const p of w.players.values()) {
    const s = slot(p.team);
    s.members.push(p.id);
    s.kills += p.kills;
    s.deaths += p.deaths;
    if (p.alive) s.alive += 1;
  }

  // 아직 아무도 없는 팀이라도 점수가 있으면 표에 남아야 한다
  // (사람이 나갔다고 그 팀의 라운드 승수가 사라지면 안 된다).
  for (const team of Object.keys(w.score)) slot(Number(team));

  for (const s of byTeam.values()) {
    s.score = w.score[s.team] ?? 0;
    s.hold = w.holdTicks[s.team] ?? 0;
  }

  return [...byTeam.values()].sort(
    (a, b) =>
      b.score - a.score ||
      b.hold - a.hold ||
      b.kills - a.kills ||
      a.deaths - b.deaths ||
      a.team - b.team,
  );
};

/** 매치를 가져가기까지 남은 라운드 승수. 0이면 이미 이겼다. */
export const roundsRemaining = (score: number, roundsToWin: number): number =>
  Math.max(0, roundsToWin - score);
