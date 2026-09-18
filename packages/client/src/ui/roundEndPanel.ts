/**
 * 라운드·매치 종료 화면.
 *
 * "누가 이겼는지"만으로는 납득이 안 된다. 이 게임은 이기는 길이 두 가지라
 * (코어를 부수거나 고지를 오래 지키거나) **왜 이겼는지 한 줄**이 있어야 한다.
 *
 * 화면을 완전히 덮지 않는다 — 뒤에서 판이 계속 돌고 사람들이 움직이는 게
 * 보이는 편이 낫다. 반투명 판 하나만 얹는다.
 */
import { TICK_HZ, TICK_MS } from '@gojijeon/shared';
import type { ClientWorld } from '../net/clientWorld';
import { teamLabel } from '../render/teamLabel';
import { el, formatClock, setShown, setText } from './dom';
import { StandingsTable } from './standingsTable';

/** 이 초 이하로 남으면 카운트다운을 강조한다. */
const URGENT_SEC = 3;

export interface RoundResult {
  kind: 'round' | 'match';
  team: number | null;
  /** 왜 이겼는가. 판정이 애매하면 null이고, 그때는 승자만 크게 보여준다. */
  reason: string | null;
}

export class RoundEndPanel {
  readonly root = el('div', { class: 'screen soft hidden' });

  private readonly titleNode = el('div', { class: 'result-title' });
  private readonly reasonNode = el('div', { class: 'result-reason' });
  private readonly clockNode = el('div', { class: 'result-clock' });
  private readonly hintNode = el('div', { class: 'hint center' });
  private readonly table = new StandingsTable('full');
  private signature = '';

  constructor() {
    const box = el('div', { class: 'panel result-card' }, [
      this.titleNode,
      this.reasonNode,
      this.table.root,
      this.clockNode,
      this.hintNode,
    ]);
    this.root.append(box);
  }

  hide(): void {
    setShown(this.root, false);
    this.signature = '';
  }

  update(world: ClientWorld, result: RoundResult): void {
    const snap = world.snapshot;
    if (!snap) return;
    setShown(this.root, true);

    const match = result.kind === 'match';
    const mine = result.team !== null && world.me !== null && world.me.team === result.team;
    const who = result.team === null ? null : teamLabel(world, result.team);

    // 제목·색은 결과가 바뀔 때만 손댄다. 카운트다운만 매 프레임 돈다.
    const sig = `${result.kind}|${result.team}|${result.reason}|${mine ? 1 : 0}`;
    if (sig !== this.signature) {
      this.signature = sig;
      setText(
        this.titleNode,
        who === null ? '무승부' : match ? `${who} 최종 승리` : `${who} 라운드 승`,
      );
      // 이긴 게 나면 금색으로 축하하고, 아니면 담담하게 둔다.
      this.titleNode.classList.toggle('win', mine);
      this.titleNode.classList.toggle('draw', who === null);
      setText(this.reasonNode, result.reason ?? '');
      setShown(this.reasonNode, result.reason !== null);
      setText(
        this.hintNode,
        match ? '곧 대기실로 돌아갑니다 — 거기서 한 판 더 시작하거나 나갈 수 있습니다.' : '',
      );
      setShown(this.hintNode, match);
    }

    this.table.update(world);

    const remain = ((snap.phaseEndTick - snap.tick) * TICK_MS) / 1000;
    setText(
      this.clockNode,
      match ? `정산까지 ${formatClock(remain)}` : `다음 라운드까지 ${formatClock(remain)}`,
    );
    this.clockNode.classList.toggle('urgent', remain <= URGENT_SEC);
  }
}

/**
 * 왜 이겼는가.
 *
 * **이벤트가 도착한 그 프레임에 판정해야 한다** — 라운드가 끝나면 코어가 회복되고
 * phaseEndTick이 정산 끝으로 갈아치워져 근거가 사라진다.
 */
export const roundReason = (world: ClientWorld, winner: number | null): string | null => {
  const snap = world.snapshot;
  if (!snap || winner === null) return null;

  // 팀전: 진 쪽 코어가 남아 있지 않으면 그게 이유다.
  const broken = snap.cores.find((c) => c.team !== winner && c.hp <= 0);
  if (broken) return '상대 코어 파괴';

  const outpost = snap.outpost;
  if (outpost && outpost.holdToWin > 0) {
    const held = outpost.hold[String(winner)] ?? 0;
    if (held >= outpost.holdToWin) {
      return `고지 ${Math.round(outpost.holdToWin / TICK_HZ)}초 점령`;
    }
  }
  // 남은 경우는 시간이 다 된 것뿐이다. 그때의 판정 기준은 점령 시간이다.
  return '시간 초과 — 고지를 더 오래 지킴';
};
