/**
 * 개인전 / 팀전 고르기.
 *
 * MODES 레지스트리를 순회한다 — 모드가 늘어도 카드만 한 장 늘고 코드는 그대로다.
 * 승리 조건 문장은 레지스트리의 blurb가 진실이고, 여기서는 "몇 편으로 갈리는가"
 * 한 줄만 보탠다(그건 규칙이 아니라 구도라 blurb에 없다).
 *
 * 싱글 단계와 방 만들기 단계가 **같은 컴포넌트**를 쓴다. 같은 선택이 화면마다
 * 다르게 생겼던 것이 이번 개편의 원인이었다.
 */
import { MODES, ModeId } from '@gojijeon/shared';
import { el } from '../dom';
import { choiceCard, choiceGrid, type ChoiceCard } from './choiceCard';

/**
 * 카드의 두 줄은 [몇 편으로 갈리는가, 어떻게 이기는가]다.
 *
 * 앞줄은 규칙이 아니라 구도라 레지스트리에 없어서 여기 적는다. 뒷줄은 **승리 조건이므로
 * blurb에서 고르기만 한다** — 문장을 베껴 두면 밸런스를 고칠 때 화면만 옛말을 한다.
 * `rule`은 blurb의 몇 번째 문장이 승리 조건인지(모드마다 서술 순서가 다르다).
 * 표에 없는 모드는 blurb 앞 두 문장으로 떨어진다.
 */
const CARD: Partial<Record<ModeId, { side: string; rule: number }>> = {
  [ModeId.FFA]: { side: '전원이 적이다.', rule: 1 },
  [ModeId.TEAM]: { side: '두 팀으로 나뉜다.', rule: 0 },
};

const sentences = (s: string): string[] =>
  s.split(/(?<=\.)\s+/).filter((part) => part.length > 0);

const cardLines = (mode: ModeId, blurb: string): string[] => {
  const parts = sentences(blurb);
  const spec = CARD[mode];
  if (!spec) return parts.slice(0, 2);
  return [spec.side, parts[spec.rule] ?? blurb];
};

export class ModePicker {
  readonly root: HTMLElement;
  private readonly cards = new Map<ModeId, ChoiceCard>();

  constructor(onPick: (mode: ModeId) => void) {
    const made: ChoiceCard[] = [];
    for (const mode of Object.values(ModeId)) {
      const def = MODES[mode];
      const card = choiceCard(def.name, cardLines(mode, def.blurb), () => onPick(mode));
      this.cards.set(mode, card);
      made.push(card);
    }
    this.root = el('div', { class: 'menu-col' }, [
      el('div', { class: 'hint', text: '승리 조건이 다릅니다. 둘 중 하나를 고르세요.' }),
      choiceGrid(made),
    ]);
  }

  update(active: ModeId, enabled: boolean): void {
    for (const [mode, card] of this.cards) card.set(mode === active, enabled);
  }
}
