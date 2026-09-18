/**
 * 멀티 대기실.
 *
 * 이 화면의 주인공은 방 코드다 — 옆자리 사람이 받아 적을 수 있어야 하므로
 * 가장 크게 그리고, 나머지는 그 아래로 내린다.
 *
 * 호스트 전용 조작은 아예 DOM에서 뺀다. 눌러 봐야 서버가 막을 버튼을 회색으로
 * 남겨 두면 "왜 안 되지"만 남는다. 반대로 방장의 시작 버튼은 남겨 두되
 * **왜 못 누르는지**를 옆에 적는다 — 그건 곧 풀릴 조건이기 때문이다.
 */
import { MATCH, type LobbyPlayer } from '@gojijeon/shared';
import { teamColor } from '../../render/colors';
import { clear, el, setShown, setText } from '../dom';
import { BotStepper } from './botStepper';
import { shareUrl } from './menuState';
import { ModePicker } from './modePicker';
import type { MenuHandlers, MenuModel } from './menuTypes';

export class RoomPanel {
  readonly root = el('div', { class: 'menu-step lobby' });

  private readonly codeNode = el('div', { class: 'roomcode mono' });
  private readonly shareUrlNode = el('div', { class: 'share-url mono' });
  private readonly copyBtn = el('button', { class: 'clickable', text: '복사' });
  private readonly copiedFlag = el('span', { class: 'copied-flag', text: '복사됨' });
  private readonly listBody = el('tbody');
  private readonly countNode = el('div', { class: 'step-title' });
  private readonly hostBox = el('div', { class: 'menu-col' });
  private readonly guestNode = el('div', { class: 'hint center' });
  private readonly readyBtn = el('button', { class: 'clickable', text: '준비' });
  private readonly startBtn = el('button', { class: 'primary clickable', text: '시작하기' });
  private readonly blockNode = el('div', { class: 'hint center' });
  private readonly modePicker: ModePicker;
  private readonly bots: BotStepper;
  private listSignature = '';
  private iAmReady = false;
  private shareCode = '';

  constructor(handlers: MenuHandlers) {
    this.modePicker = new ModePicker(handlers.onMode);
    this.bots = new BotStepper(0, handlers.onBots);

    this.copyBtn.addEventListener('click', () => void this.copyShare());
    this.readyBtn.addEventListener('click', () => handlers.onReady(!this.iAmReady));
    this.startBtn.addEventListener('click', () => handlers.onStart());
    setShown(this.copiedFlag, false);

    this.hostBox.append(
      el('div', { class: 'step-title', text: '방 설정' }),
      this.modePicker.root,
      this.bots.root,
    );

    const leaveBtn = el('button', { class: 'clickable', text: '나가기' });
    leaveBtn.addEventListener('click', () => handlers.onLeave());

    this.root.append(
      el('div', { class: 'hint center', text: '이 코드를 같이 할 사람에게 불러 주세요' }),
      this.codeNode,
      el('div', { class: 'share-row' }, [this.shareUrlNode, this.copyBtn, this.copiedFlag]),
      this.countNode,
      el('table', { class: 'roster' }, [this.listBody]),
      this.hostBox,
      this.guestNode,
      this.blockNode,
      el('div', { class: 'row center' }, [this.readyBtn, this.startBtn, leaveBtn]),
    );
  }

  update(m: MenuModel): void {
    const room = m.room;
    if (!room) return;
    this.shareCode = room.code;
    setText(this.codeNode, room.code);
    setText(this.shareUrlNode, shareUrl(room.code));

    const me = m.players.find((p) => p.id === m.youId);
    this.iAmReady = me ? me.ready : false;
    setText(this.readyBtn, this.iAmReady ? '준비 취소' : '준비');
    this.readyBtn.classList.toggle('primary', !this.iAmReady);

    const humans = m.players.filter((p) => !p.bot).length;

    // 방장이 아니면 방 설정은 존재조차 하지 않아야 한다.
    setShown(this.hostBox, m.isHost);
    setShown(this.startBtn, m.isHost);
    setShown(this.guestNode, !m.isHost);
    if (m.isHost) {
      this.modePicker.update(room.mode, true);
      this.bots.update(room.bots, room.mode, true, humans);
      this.startBtn.disabled = !m.canStart;
    } else {
      setText(this.guestNode, '방장이 시작하기를 기다리는 중…');
    }

    setText(this.countNode, `참가자 ${m.players.length} / ${room.capacity}`);

    // 못 누르는 버튼 옆에는 반드시 이유가 있어야 한다.
    const block = m.isHost && !m.canStart ? blockReason(m.players, humans) : '';
    setShown(this.blockNode, block !== '');
    setText(this.blockNode, block);

    this.updateList(m);
  }

  /** 클립보드는 권한·컨텍스트에 따라 그냥 실패한다. 실패해도 주소는 화면에 그대로 있다. */
  private async copyShare(): Promise<void> {
    try {
      await navigator.clipboard.writeText(shareUrl(this.shareCode));
      setShown(this.copiedFlag, true);
      window.setTimeout(() => setShown(this.copiedFlag, false), 1400);
    } catch {
      /* 조용히 넘어간다. */
    }
  }

  private updateList(m: MenuModel): void {
    const hostId = m.room ? m.room.hostId : -1;
    const sig = m.players
      .map((p) => `${p.id}:${p.name}:${p.ready ? 1 : 0}:${p.connected ? 1 : 0}:${p.bot ? 1 : 0}:${p.team}`)
      .join('|') + `#${hostId}#${m.youId}`;
    if (sig === this.listSignature) return;
    this.listSignature = sig;

    clear(this.listBody);
    for (const p of m.players) {
      const dot = el('span', { class: 'sw' });
      dot.style.background = teamColor(p.team);
      dot.style.display = 'inline-block';
      dot.style.width = '10px';
      dot.style.height = '10px';
      dot.style.borderRadius = '2px';
      dot.style.marginRight = '9px';

      const cells: Node[] = [dot, document.createTextNode(p.name)];
      if (p.id === m.youId) cells.push(el('span', { class: 'badge me', text: '나' }));
      if (p.id === hostId) cells.push(el('span', { class: 'badge host', text: '방장' }));
      if (p.bot) cells.push(el('span', { class: 'badge', text: '컴' }));

      const status = statusOf(p);
      this.listBody.append(
        el('tr', { class: p.id === m.youId ? 'me' : '' }, [
          el('td', {}, cells),
          el('td', { class: `status ${p.ready || p.bot ? 'ready-yes' : 'muted'}`, text: status }),
        ]),
      );
    }
  }
}

const statusOf = (p: LobbyPlayer): string => {
  if (p.bot) return '준비됨';
  if (!p.connected) return '끊김';
  return p.ready ? '준비됨' : '대기';
};

/** 왜 시작할 수 없는가. 사람 이름을 대는 것이 "준비 안 됨"보다 훨씬 빠르다. */
const blockReason = (players: readonly LobbyPlayer[], humans: number): string => {
  if (humans < MATCH.minPlayers) {
    return `사람이 ${MATCH.minPlayers}명 이상이어야 시작할 수 있습니다 (지금 ${humans}명).`;
  }
  const waiting = players.filter((p) => !p.bot && p.connected && !p.ready).map((p) => p.name);
  if (waiting.length === 0) return '';
  if (waiting.length === 1) return `${waiting[0]}님이 아직 준비하지 않았습니다.`;
  return `${waiting.length}명이 아직 준비하지 않았습니다 — ${waiting.join(', ')}`;
};
