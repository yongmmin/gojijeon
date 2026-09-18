/** DOM 오버레이용 최소 헬퍼. 프레임워크를 들이지 않는 대신 이 파일 하나로 버틴다. */

export interface ElOptions {
  class?: string;
  text?: string;
  title?: string;
  id?: string;
}

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: ElOptions = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.title) node.title = opts.title;
  if (opts.id) node.id = opts.id;
  for (const c of children) node.append(c);
  return node;
};

export const setText = (node: HTMLElement, text: string): void => {
  if (node.textContent !== text) node.textContent = text;
};

export const setShown = (node: HTMLElement, shown: boolean): void => {
  node.classList.toggle('hidden', !shown);
};

export const clear = (node: HTMLElement): void => {
  node.replaceChildren();
};

/** 색 견본 + 이름 + 부가정보로 된 선택 항목. 건설 팔레트와 전리품 안내판이 같은 모양을 쓴다. */
export interface ChipModel {
  key: string;
  name: string;
  color: string;
  cost: string;
  enabled: boolean;
  selected: boolean;
  hint: string;
}

export const chip = (m: ChipModel, onPick: () => void): HTMLElement => {
  const sw = el('span', { class: 'sw' });
  sw.style.background = m.color;
  const node = el('button', { class: `chip clickable${m.enabled ? '' : ' off'}`, title: m.hint }, [
    sw,
    el('span', { class: 'key', text: m.key }),
    el('span', { text: m.name }),
    el('span', { class: 'cost', text: m.cost }),
  ]);
  node.style.borderColor = m.selected ? m.color : '';
  node.disabled = !m.enabled;
  node.addEventListener('click', onPick);
  return node;
};

export const formatClock = (seconds: number): string => {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
