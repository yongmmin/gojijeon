/**
 * 메뉴 화면 전체.
 *
 * 단계마다 화면에 하나만 보인다 — 한 화면에 결정 하나가 규칙이다. 다만 결정을
 * 하나로 줄여 놓고 **그게 무슨 결정인지 안 알려주면** 아무 소용이 없다. 그래서
 * 모든 선택지는 제목 + 설명이 붙은 큰 카드이고, 단계 머리(뒤로 + 제목)는 어느
 * 단계에서나 같은 자리에 있다.
 */
import { isRoomCode } from '@gojijeon/shared';
import { el, setShown, setText } from '../dom';
import { BotStepper } from './botStepper';
import { choiceCard, choiceGrid } from './choiceCard';
import { CodeEntry } from './codeEntry';
import { ModePicker } from './modePicker';
import { RoomPanel } from './roomPanel';
import { STEP_BACK, type MenuHandlers, type MenuModel, type MenuStep } from './menuTypes';

const PENDING_TEXT: Readonly<Record<MenuStep, string>> = {
  name: '다시 접속하는 중…',
  single: '방을 만드는 중…',
  multi: '잠시만요…',
  create: '방을 만드는 중…',
  join: '방에 들어가는 중…',
  room: '경기를 준비하는 중…',
};

/** 부제는 게임 설명이다. 이름이 고지전인데 고지 얘기가 없으면 안 된다. */
const TAGLINE = '맵 한가운데 고지를 10초 지키면 내 것이 된다. 손에 드는 무기는 하나뿐.';

export class MenuView {
  readonly root = el('div', { class: 'screen' });

  private readonly nameInput = el('input') as HTMLInputElement;
  private readonly steps = new Map<MenuStep, HTMLElement>();
  private readonly noticeNode = el('div', { class: 'notice center' });
  private readonly pendingNode = el('div', { class: 'hint center' });
  private readonly singleMode: ModePicker;
  private readonly createMode: ModePicker;
  private readonly singleBots: BotStepper;
  private readonly codeEntry: CodeEntry;
  private readonly room: RoomPanel;
  /**
   * 대기실 밖에서도 방에 묶여 있을 수 있다(싱글 준비 중, 매치 종료 후 로비 복귀).
   * 그때 나갈 길이 없으면 새로고침 말고는 방법이 없어진다.
   */
  private readonly leaveRow = el('div', { class: 'row center' });
  /** 이름·코드가 채워져야 눌리는 버튼들. 조건 검사를 한 곳에 모아 둔다. */
  private readonly gated: Array<{ btn: HTMLButtonElement; gate: 'name' | 'code' }> = [];
  /** 단계가 바뀌는 순간에만 포커스를 옮긴다 — 매 프레임 옮기면 타이핑이 끊긴다. */
  private shownStep: MenuStep | null = null;

  constructor(private readonly handlers: MenuHandlers) {
    this.singleMode = new ModePicker(handlers.onMode);
    this.createMode = new ModePicker(handlers.onMode);
    this.singleBots = new BotStepper(1, handlers.onBots);
    this.codeEntry = new CodeEntry(handlers.onCodeChange, handlers.onJoin);
    this.room = new RoomPanel(handlers);

    this.steps.set('name', this.buildName());
    this.steps.set('single', this.buildSingle());
    this.steps.set('multi', this.buildMulti());
    this.steps.set('create', this.buildCreate());
    this.steps.set('join', this.buildJoin());
    this.steps.set('room', this.room.root);

    const leaveBtn = el('button', { class: 'clickable', text: '나가기' });
    leaveBtn.addEventListener('click', () => handlers.onLeave());
    this.leaveRow.append(leaveBtn);

    const card = el('div', { class: 'panel menu-card' }, [
      ...this.steps.values(),
      this.pendingNode,
      this.noticeNode,
      this.leaveRow,
    ]);

    this.root.append(
      el('h1', { text: '고지전' }),
      el('div', { class: 'muted', text: TAGLINE }),
      card,
    );
  }

  update(m: MenuModel): void {
    for (const [step, node] of this.steps) setShown(node, step === m.step);

    const live = !m.pending;
    if (this.nameInput.value !== m.name && document.activeElement !== this.nameInput) {
      this.nameInput.value = m.name;
    }
    this.nameInput.disabled = !live;
    this.singleMode.update(m.mode, live);
    this.createMode.update(m.mode, live);
    this.singleBots.update(m.bots, m.mode, live);
    this.codeEntry.update(m.code, live);
    if (m.step === 'room') this.room.update(m);

    for (const { btn, gate } of this.gated) {
      btn.disabled = !live || (gate === 'name' ? m.name.trim().length === 0 : !isRoomCode(m.code));
    }

    setShown(this.pendingNode, m.pending);
    // 방이 이미 잡혔다면 남은 것은 경기 시작뿐이다 — "만드는 중"이 아니다.
    setText(this.pendingNode, m.room ? PENDING_TEXT.room : PENDING_TEXT[m.step]);
    setShown(this.leaveRow, m.room !== null && m.step !== 'room');
    setShown(this.noticeNode, m.notice !== null);
    setText(this.noticeNode, m.notice ?? '');

    if (this.shownStep !== m.step) {
      this.shownStep = m.step;
      this.focusStep(m.step);
    }
  }

  private focusStep(step: MenuStep): void {
    if (step === 'name' && !this.nameInput.value) this.nameInput.focus();
    else if (step === 'join') this.codeEntry.focus();
  }

  // ── 단계 조립 ──────────────────────────────────────────────────────────────

  private buildName(): HTMLElement {
    this.nameInput.type = 'text';
    this.nameInput.className = 'clickable name-input';
    this.nameInput.placeholder = '이름 (최대 12자)';
    this.nameInput.maxLength = 12;
    this.nameInput.addEventListener('input', () => this.handlers.onNameChange(this.nameInput.value));

    // 둘은 대등한 선택이다. 한쪽만 강조하면 추천처럼 보여 다른 쪽을 안 누른다.
    const single = this.choice('혼자 하기', ['컴퓨터와 대결 · 바로 시작'], 'single');
    const multi = this.choice('같이 하기', ['팀원과 코드로 접속 · 2~8명'], 'multi');

    return this.step('시작', null, [
      el('div', { class: 'lead', text: '이름을 정하세요. 다른 사람 화면에 이 이름이 뜹니다.' }),
      this.nameInput,
      choiceGrid([single, multi]),
    ]);
  }

  private buildSingle(): HTMLElement {
    const start = this.gateBtn('시작하기', 'name', true, () => this.handlers.onCreate(true));
    return this.step('혼자 하기', 'single', [
      this.singleMode.root,
      this.singleBots.root,
      el('div', { class: 'row center' }, [start]),
    ]);
  }

  private buildMulti(): HTMLElement {
    const create = this.choice(
      '방 만들기',
      ['내가 방장이 된다.', '코드를 받아 팀원에게 알려준다.'],
      'create',
    );
    const join = this.choice(
      '코드로 들어가기',
      ['방장이 불러 준 4자 코드를 입력한다.'],
      'join',
    );
    return this.step('같이 하기', 'multi', [choiceGrid([create, join])]);
  }

  private buildCreate(): HTMLElement {
    const make = this.gateBtn('방 만들기', 'name', true, () => this.handlers.onCreate(false));
    return this.step('방 만들기', 'create', [
      this.createMode.root,
      el('div', {
        class: 'hint center',
        text: '방을 만든 뒤에도 대기실에서 모드와 컴퓨터 수를 바꿀 수 있습니다.',
      }),
      el('div', { class: 'row center' }, [make]),
    ]);
  }

  private buildJoin(): HTMLElement {
    const enter = this.gateBtn('입장', 'code', true, () => this.handlers.onJoin());
    return this.step('코드로 들어가기', 'join', [
      el('div', { class: 'lead center', text: '방장이 불러 준 4자 코드를 입력하세요.' }),
      el('div', { class: 'row center' }, [this.codeEntry.root]),
      el('div', { class: 'row center' }, [enter]),
    ]);
  }

  /** 다음 단계로 넘어가는 큰 카드. 눌리려면 이름이 있어야 한다. */
  private choice(title: string, lines: readonly string[], to: MenuStep): ReturnType<typeof choiceCard> {
    const card = choiceCard(title, lines, () => this.handlers.onStep(to));
    this.gated.push({ btn: card.node, gate: 'name' });
    return card;
  }

  /** 이름이나 코드가 준비돼야 눌리는 버튼. 조건은 update가 한 곳에서 건다. */
  private gateBtn(text: string, gate: 'name' | 'code', primary: boolean, onClick: () => void): HTMLButtonElement {
    const btn = el('button', { class: `clickable${primary ? ' primary' : ''}`, text });
    btn.addEventListener('click', onClick);
    this.gated.push({ btn, gate });
    return btn;
  }

  /** 뒤로(좌) + 제목(중앙). 자리가 고정돼야 "어디로 돌아가는지"를 찾지 않는다. */
  private step(title: string, from: MenuStep | null, children: readonly HTMLElement[]): HTMLElement {
    const target = from ? STEP_BACK[from] : null;
    const head = el('div', { class: 'step-head' }, [
      target ? this.backBtn(target) : el('span'),
      el('div', { class: 'step-title', text: title }),
      el('span'),
    ]);
    return el('div', { class: 'menu-step' }, [head, ...children]);
  }

  private backBtn(target: MenuStep): HTMLButtonElement {
    const btn = el('button', { class: 'clickable btn-back', text: '← 뒤로' });
    btn.addEventListener('click', () => this.handlers.onStep(target));
    return btn;
  }
}
