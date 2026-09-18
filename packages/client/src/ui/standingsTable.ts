/**
 * 순위표.
 *
 * **줄 세우기는 서버가 끝내서 보낸다**(라운드 승 → 점령 시간 → 킬 → 적게 죽은 순).
 * 그 기준은 승리 조건에 묶여 있어 서버 소유다 — 클라가 다시 정렬하면 둘이
 * 조용히 어긋나는 날이 온다. 여기서는 받은 순서를 그대로 그린다.
 *
 * 상시(우상단)와 라운드 종료 화면이 **같은 컴포넌트**를 크기만 바꿔 쓴다.
 * 두 곳의 표기가 다르면 어느 쪽이 맞는지 다시 확인해야 한다.
 */
import { TICK_HZ, ModeId, type NetStanding } from '@gojijeon/shared';
import type { ClientWorld } from '../net/clientWorld';
import { teamColor } from '../render/colors';
import { teamLabel } from '../render/teamLabel';
import { clear, el, formatClock, setText } from './dom';

export type StandingsSize = 'compact' | 'full';

const HEADERS = ['#', '이름', '승', '점령', '킬', '데스'] as const;

export class StandingsTable {
  readonly root: HTMLElement;

  private readonly body = el('tbody');
  private signature = '';

  constructor(private readonly size: StandingsSize) {
    this.root = el('table', { class: `standings ${size}` }, [
      el('thead', {}, [el('tr', {}, HEADERS.map((h, i) => el('th', { class: i >= 2 ? 'num' : '', text: h })))]),
      this.body,
    ]);
  }

  update(world: ClientWorld): void {
    const snap = world.snapshot;
    if (!snap) return;
    const rows = snap.standings;
    const ffa = world.mode !== ModeId.TEAM;
    const goal = snap.outpost ? snap.outpost.holdToWin : 0;

    // 매 프레임 표를 다시 만들면 카운트다운이 도는 동안 글자가 깜빡인다.
    const sig = rows
      .map((s) => `${s.team}:${s.score}:${Math.round(s.hold / TICK_HZ)}:${s.kills}:${s.deaths}:${s.alive}`)
      .join('|') + `#${snap.roundsToWin}#${goal}#${world.youId}#${ffa ? 1 : 0}`;
    if (sig === this.signature) return;
    this.signature = sig;

    clear(this.body);
    rows.forEach((s, i) => this.body.append(this.row(world, s, i, ffa, snap.roundsToWin, goal)));
  }

  private row(
    world: ClientWorld,
    s: NetStanding,
    index: number,
    ffa: boolean,
    roundsToWin: number,
    goal: number,
  ): HTMLElement {
    const mine = s.members.includes(world.youId);
    // 개인전에서는 한 줄이 곧 한 사람이라 생사가 의미를 갖는다. 팀전은 인원수라 애매하다.
    const down = ffa && s.alive === 0;
    const matchPoint = roundsToWin > 0 && s.score >= roundsToWin - 1 && s.score < roundsToWin;

    const dot = el('span', { class: 'sw' });
    dot.style.background = teamColor(s.team);

    const rank = el('td', { class: 'rank', text: index === 0 ? '★' : String(index + 1) });
    const name = el('td', {}, [dot, document.createTextNode(` ${teamLabel(world, s.team)}`)]);
    const win = el('td', { class: `num${matchPoint ? ' hot' : ''}`, text: `${s.score} / ${roundsToWin}` });
    const hold = el('td', { class: 'num', text: holdText(s.hold, ffa ? goal : 0) });

    const classes = ['srow'];
    if (mine) classes.push('me');
    if (index === 0) classes.push('lead');
    if (down) classes.push('down');
    return el('tr', { class: classes.join(' ') }, [
      rank, name, win, hold,
      el('td', { class: 'num', text: String(s.kills) }),
      el('td', { class: 'num', text: String(s.deaths) }),
    ]);
  }

  /** 상시 순위표는 좁은 자리에 있으므로 제목을 따로 붙여 준다. */
  static titled(size: StandingsSize, title: string): { root: HTMLElement; table: StandingsTable } {
    const table = new StandingsTable(size);
    const head = el('div', { class: 'standings-title' });
    setText(head, title);
    return { root: el('div', { class: 'standings-box' }, [head, table.root]), table };
  }
}

/** 점령 시간. 승리 조건이 걸려 있으면(개인전) 목표까지 같이 보여준다. */
const holdText = (holdTicks: number, goalTicks: number): string => {
  const now = formatClock(holdTicks / TICK_HZ);
  return goalTicks > 0 ? `${now} / ${formatClock(goalTicks / TICK_HZ)}` : now;
};
