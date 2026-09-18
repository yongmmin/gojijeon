/**
 * 큰 선택 카드.
 *
 * 메뉴에서 되풀이되는 유일한 모양이다 — 혼자/같이, 방 만들기/코드 입력,
 * 개인전/팀전이 전부 이 카드를 쓴다. **같은 선택은 같은 모양이어야** 화면마다
 * 다시 배우지 않는다.
 *
 * 제목 한 줄 + 설명 여러 줄. 설명이 없으면 카드를 만들 이유가 없으므로 필수다.
 */
import { el } from '../dom';

export interface ChoiceCard {
  readonly node: HTMLButtonElement;
  /** 선택 표시(테두리 + 체크)와 활성 여부. */
  set(selected: boolean, enabled: boolean): void;
}

export const choiceCard = (
  title: string,
  lines: readonly string[],
  onPick: () => void,
): ChoiceCard => {
  const node = el('button', { class: 'choice clickable' }, [
    el('span', { class: 'ct', text: title }),
    ...lines.map((text) => el('span', { class: 'cd', text })),
  ]);
  node.addEventListener('click', onPick);

  return {
    node,
    set(selected, enabled) {
      node.classList.toggle('on', selected);
      node.disabled = !enabled;
    },
  };
};

/** 카드 두 장을 나란히. 좁은 화면에서는 CSS가 한 줄로 떨어뜨린다. */
export const choiceGrid = (cards: readonly ChoiceCard[]): HTMLElement =>
  el('div', { class: 'choice-grid' }, cards.map((c) => c.node));
