/**
 * 화면 전체를 덮는 상태 표시(연결 끊김·사망·라운드 종료).
 *
 * 내용이 같으면 DOM을 다시 만들지 않는다 — 카운트다운처럼 매 프레임 갱신되는
 * 부제만 텍스트를 갈아끼운다.
 */
import { el, setShown, setText } from './dom';

export interface OverlayAction {
  label: string;
  onClick: () => void;
  primary?: boolean;
}

export class Overlay {
  readonly root = el('div', { class: 'screen hidden' });
  private readonly titleNode = el('h1');
  private readonly subNode = el('div', { class: 'muted' });
  private readonly actionsNode = el('div', { class: 'chips' });
  private signature = '';

  constructor() {
    this.actionsNode.style.marginTop = '6px';
    // 아래에 로비나 게임 화면이 비치므로 내용은 판 위에 올려 읽히게 한다.
    const box = el('div', { class: 'panel' }, [this.titleNode, this.subNode, this.actionsNode]);
    box.style.padding = '22px 34px';
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.alignItems = 'center';
    box.style.gap = '10px';
    box.style.background = 'rgba(10,13,19,0.94)';
    this.root.append(box);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(title: string, subtitle = '', actions: readonly OverlayAction[] = [], soft = false): void {
    const sig = `${title}|${actions.map((a) => a.label).join(',')}|${soft}`;
    if (sig !== this.signature) {
      this.signature = sig;
      setText(this.titleNode, title);
      this.root.classList.toggle('soft', soft);
      this.actionsNode.replaceChildren(
        ...actions.map((a) => {
          const b = el('button', { class: a.primary ? 'primary' : '', text: a.label });
          b.addEventListener('click', a.onClick);
          return b;
        }),
      );
    }
    setText(this.subNode, subtitle);
    setShown(this.root, true);
  }

  hide(): void {
    if (!this.visible) return;
    this.signature = '';
    setShown(this.root, false);
  }
}
