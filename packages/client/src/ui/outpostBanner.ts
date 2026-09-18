/**
 * 고지 상태 배너(화면 상단).
 *
 * 맵 한가운데를 보고 있지 않아도 지금 누가 먹고 있는지 알아야 움직일 수 있다.
 * 판정은 전부 서버가 하고 여기서는 NetOutpost를 읽어 문장으로 바꾸기만 한다.
 */
import { Phase, TICK_HZ, type NetOutpost } from '@gojijeon/shared';
import type { ClientWorld } from '../net/clientWorld';
import { teamColor } from '../render/colors';
import { teamLabel } from '../render/teamLabel';
import { OUTPOST_VIS } from '../render/visualConfig';
import { clear, el, setShown, setText } from './dom';

export class OutpostBanner {
  readonly root = el('div', { class: 'panel corner tc' });

  private readonly titleNode = el('div');
  private readonly stateNode = el('div', { class: 'muted mono' });
  private readonly barWrap = el('div', { class: 'bar' });
  private readonly barFill = el('i');
  private readonly holdNode = el('div', { class: 'muted mono' });
  private holdSignature = '';

  constructor() {
    // 페이즈/시계 패널 바로 아래. 두 개가 겹치면 둘 다 안 읽힌다.
    this.root.style.top = '92px';
    this.root.style.minWidth = '210px';
    this.barWrap.style.width = '100%';
    this.barWrap.style.marginTop = '4px';
    this.barWrap.append(this.barFill);
    this.root.append(this.titleNode, this.stateNode, this.barWrap, this.holdNode);
    setShown(this.root, false);
  }

  update(world: ClientWorld, outpost: NetOutpost | undefined): void {
    setShown(this.root, outpost !== undefined);
    if (!outpost) return;

    const owner = outpost.owner;
    setText(this.titleNode, owner === null ? '고지 — 중립' : `고지 — ${teamLabel(world, owner)} 점령`);
    this.titleNode.style.color = owner === null ? OUTPOST_VIS.neutral : teamColor(owner);

    const pct = Math.round(Math.min(1, Math.max(0, outpost.progress)) * 100);
    const capturing = outpost.capturing;
    // 준비 중에는 중앙이 봉쇄되어 있어 게이지가 절대 움직이지 않는다. 그걸 먼저 말한다.
    if (world.snapshot?.phase === Phase.PREP) {
      setText(this.stateNode, '준비 중 — 중앙이 봉쇄되어 아직 점령할 수 없다');
      this.stateNode.style.color = '';
      this.barFill.style.width = '0%';
      setShown(this.holdNode, false);
      return;
    }
    if (outpost.contested) {
      setText(this.stateNode, `경합 중 — 점령이 멈췄다 (${pct}%)`);
      this.stateNode.style.color = OUTPOST_VIS.contest;
    } else if (capturing !== null) {
      setText(this.stateNode, `${teamLabel(world, capturing)} 점령 중 ${pct}%`);
      this.stateNode.style.color = teamColor(capturing);
    } else {
      setText(this.stateNode, pct > 0 ? `진행 ${pct}% (되돌아가는 중)` : '아무도 없다 — 서 있으면 점령된다');
      this.stateNode.style.color = '';
    }

    this.barFill.style.width = `${pct}%`;
    this.barFill.style.background = outpost.contested
      ? OUTPOST_VIS.contest
      : capturing !== null
        ? teamColor(capturing)
        : OUTPOST_VIS.neutral;

    this.updateHold(world, outpost);
  }

  /** 개인전에서는 누적 점령 시간이 곧 승리 조건이다. 승부가 어디쯤인지 보여준다. */
  private updateHold(world: ClientWorld, outpost: NetOutpost): void {
    const rows = Object.entries(outpost.hold).filter(([, ticks]) => ticks > 0);
    const show = outpost.holdToWin > 0 && rows.length > 0;
    setShown(this.holdNode, show);
    if (!show) {
      this.holdSignature = '';
      return;
    }

    rows.sort((a, b) => b[1] - a[1]);
    const goal = outpost.holdToWin / TICK_HZ;
    // 이름이 바뀌는 경우(합류·퇴장)도 있으므로 표시 문자열까지 서명에 넣는다.
    const lines = rows.map(([team, ticks]) => ({
      team: Number(team),
      text: `${teamLabel(world, Number(team))} ${Math.floor(ticks / TICK_HZ)}s / ${Math.round(goal)}s`,
    }));
    const sig = lines.map((l) => l.text).join('|');
    if (sig === this.holdSignature) return;
    this.holdSignature = sig;

    clear(this.holdNode);
    for (const line of lines) {
      const dot = el('span', { class: 'sw' });
      dot.style.background = teamColor(line.team);
      dot.style.display = 'inline-block';
      dot.style.width = '8px';
      dot.style.height = '8px';
      dot.style.marginRight = '5px';
      this.holdNode.append(el('div', {}, [dot, document.createTextNode(line.text)]));
    }
  }
}
