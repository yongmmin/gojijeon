/**
 * 화면 한가운데 짧게 터지는 알림.
 *
 * 준비 시간이 10초뿐이라 상단 배너 글자가 조용히 바뀌는 것만으로는 전투가
 * 시작된 줄 모른다. 이 게임에서 제일 중요한 순간이므로 봉쇄벽이 무너지는
 * 프레임에 화면 한가운데서 한 번 터져야 한다.
 *
 * 조작을 막지 않는다(pointer-events 없음) — 알림 때문에 첫 한 걸음이 늦으면
 * 알림이 오히려 손해다.
 */
import { el, setShown } from './dom';

/** 뜬 뒤 이만큼 살아 있다가 사라진다. 길면 정작 고지가 안 보인다. */
const LIFE_MS = 1200;
/** 마지막 이만큼을 페이드아웃에 쓴다. */
const FADE_MS = 500;

export class Announce {
  readonly root = el('div', { class: 'announce' });
  private readonly titleNode = el('div', { class: 'announce-title' });
  private readonly subNode = el('div', { class: 'announce-sub' });
  private shownAt = -Infinity;

  constructor() {
    this.root.append(this.titleNode, this.subNode);
    setShown(this.root, false);
  }

  show(title: string, sub: string, nowMs: number): void {
    this.titleNode.textContent = title;
    this.subNode.textContent = sub;
    this.shownAt = nowMs;
    setShown(this.root, true);
  }

  update(nowMs: number): void {
    const age = nowMs - this.shownAt;
    if (age > LIFE_MS) {
      setShown(this.root, false);
      return;
    }
    // 커지면서 옅어진다. 들어올 때만 살짝 튀어 눈이 먼저 여기로 온다.
    const fade = age < LIFE_MS - FADE_MS ? 1 : (LIFE_MS - age) / FADE_MS;
    const pop = age < 140 ? 0.82 + (age / 140) * 0.18 : 1 + (1 - fade) * 0.12;
    this.root.style.opacity = fade.toFixed(3);
    this.root.style.transform = `translate(-50%, -50%) scale(${pop.toFixed(3)})`;
  }

  hide(): void {
    this.shownAt = -Infinity;
    setShown(this.root, false);
  }
}
