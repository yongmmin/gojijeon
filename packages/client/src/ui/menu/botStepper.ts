/**
 * 컴퓨터 수 조절(− N +) + 그 수가 무슨 뜻인지 한 줄.
 *
 * 숫자를 직접 타이핑하게 두면 범위를 넘긴 값이 서버까지 간다. 버튼만 둔다.
 * 싱글은 최소 1명(혼자면 게임이 안 된다), 멀티 대기실은 0명이 기본이라 하한이 다르다.
 *
 * 숫자만으로는 2대2인지 4인 개인전인지 알 수 없다 — 그 문장이 이 컴포넌트의 절반이다.
 */
import type { ModeId } from '@gojijeon/shared';
import { el, setText } from '../dom';
import { lineup } from './lineup';
import { BOTS_MAX } from './menuState';

export const clampBots = (n: number, min: number): number =>
  Math.max(min, Math.min(BOTS_MAX, Math.round(n)));

export class BotStepper {
  readonly root = el('div', { class: 'menu-col' });
  private readonly minus = el('button', { class: 'clickable', text: '−' });
  private readonly plus = el('button', { class: 'clickable', text: '+' });
  private readonly value = el('div', { class: 'val mono' });
  private readonly lineupNode = el('div', { class: 'lead center' });
  private count = 0;

  constructor(private readonly min: number, onChange: (count: number) => void) {
    this.count = min;
    this.minus.addEventListener('click', () => onChange(clampBots(this.count - 1, this.min)));
    this.plus.addEventListener('click', () => onChange(clampBots(this.count + 1, this.min)));

    const row = el('div', { class: 'row center stepper' }, [this.minus, this.value, this.plus]);
    this.root.append(
      el('div', { class: 'hint center', text: '컴퓨터를 몇 명 넣을까요' }),
      row,
      this.lineupNode,
    );
  }

  update(count: number, mode: ModeId, enabled: boolean, humans = 1): void {
    this.count = count;
    setText(this.value, `컴퓨터 ${count}명`);
    setText(this.lineupNode, lineup(mode, count, humans).text);
    this.minus.disabled = !enabled || count <= this.min;
    this.plus.disabled = !enabled || count >= BOTS_MAX;
  }
}
