/**
 * 키보드·마우스 → 서버가 이해하는 입력.
 *
 * 여기서는 게임 상태를 만들지 않는다. "지금 무엇이 눌려 있는가"와
 * "이번 프레임에 무엇이 새로 눌렸는가"만 알려준다. 해석은 씬이 한다.
 */
import { Button } from '@gojijeon/shared';

export type UiCommand =
  | { c: 'toggleBuild' }
  | { c: 'toggleLoot' }
  | { c: 'digit'; n: number }
  | { c: 'click'; button: 'left' | 'right' }
  | { c: 'cycleFollow' }
  | { c: 'escape' };

const MOVE_KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
} as const;

/**
 * 아주 짧은 클릭이 프레임 사이에 끼어 사라지는 것을 막는 유예(ms).
 * 입력은 30Hz로만 나가므로, 누른 흔적을 최소 한 번은 실어 보낸다.
 */
const PRESS_LATCH_MS = 90;

export interface ButtonOptions {
  /** 건설 모드에서는 좌클릭이 "설치"로 쓰이므로 공격 비트를 보내지 않는다. */
  suppressPrimary: boolean;
}

export class InputController {
  private readonly keys = new Set<string>();
  /** 키/버튼이 마지막으로 눌린 시각. 짧은 입력을 놓치지 않기 위한 것. */
  private readonly downAt = new Map<string, number>();
  private commands: UiCommand[] = [];
  private leftDown = false;
  private rightDown = false;
  /** 캔버스 기준 화면 좌표. */
  mouseX = 0;
  mouseY = 0;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    // 이름 입력칸 같은 곳에 포커스가 있으면 게임 입력으로 먹지 않는다.
    if (isTypingTarget(e.target)) return;
    if (e.repeat) {
      e.preventDefault();
      return;
    }
    this.keys.add(e.code);
    this.downAt.set(e.code, performance.now());

    if (e.code === 'KeyB') this.commands.push({ c: 'toggleBuild' });
    else if (e.code === 'KeyC') this.commands.push({ c: 'toggleLoot' });
    else if (e.code === 'KeyF') this.commands.push({ c: 'cycleFollow' });
    else if (e.code === 'Escape') this.commands.push({ c: 'escape' });
    else if (/^Digit[1-9]$/.test(e.code)) this.commands.push({ c: 'digit', n: Number(e.code.slice(5)) });

    // 스크롤·탐색 단축키가 게임 위에서 튀는 것을 막는다.
    if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab') e.preventDefault();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    const rect = this.canvas?.getBoundingClientRect();
    this.mouseX = e.clientX - (rect ? rect.left : 0);
    this.mouseY = e.clientY - (rect ? rect.top : 0);
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) {
      this.leftDown = true;
      this.downAt.set('Mouse0', performance.now());
      this.commands.push({ c: 'click', button: 'left' });
    } else if (e.button === 2) {
      this.rightDown = true;
      this.downAt.set('Mouse2', performance.now());
      this.commands.push({ c: 'click', button: 'right' });
    }
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.leftDown = false;
    if (e.button === 2) this.rightDown = false;
  };

  private readonly onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  /** 포커스를 잃으면 키가 눌린 채로 굳는다. 알트탭 한 번에 벽으로 걸어가는 사고를 막는다. */
  private readonly onBlur = (): void => this.clear();

  private canvas: HTMLCanvasElement | null = null;

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onBlur);
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onBlur);
    this.canvas?.removeEventListener('mousedown', this.onMouseDown);
    this.canvas?.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas = null;
    this.clear();
  }

  clear(): void {
    this.keys.clear();
    this.downAt.clear();
    this.leftDown = false;
    this.rightDown = false;
    this.commands = [];
  }

  drainCommands(): UiCommand[] {
    if (this.commands.length === 0) return [];
    return this.commands.splice(0, this.commands.length);
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** -1..1 정규화된 이동 의도. 대각선이 빠르지 않도록 길이를 1로 맞춘다. */
  moveVector(): { mx: number; my: number } {
    let mx = 0;
    let my = 0;
    if (MOVE_KEYS.left.some((k) => this.keys.has(k))) mx -= 1;
    if (MOVE_KEYS.right.some((k) => this.keys.has(k))) mx += 1;
    if (MOVE_KEYS.up.some((k) => this.keys.has(k))) my -= 1;
    if (MOVE_KEYS.down.some((k) => this.keys.has(k))) my += 1;
    const len = Math.hypot(mx, my);
    return len > 1 ? { mx: mx / len, my: my / len } : { mx, my };
  }

  buttonMask({ suppressPrimary }: ButtonOptions): number {
    const now = performance.now();
    const held = (code: string, down: boolean): boolean =>
      down || now - (this.downAt.get(code) ?? -Infinity) < PRESS_LATCH_MS;

    let m = 0;
    if (!suppressPrimary && held('Mouse0', this.leftDown)) m |= Button.PRIMARY;
    if (held('Mouse2', this.rightDown)) m |= Button.SECONDARY;
    if (held('KeyQ', this.keys.has('KeyQ'))) m |= Button.DROP;
    if (held('KeyE', this.keys.has('KeyE'))) m |= Button.INTERACT;
    return m;
  }
}

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
};
