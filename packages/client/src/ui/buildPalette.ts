/**
 * 건설 팔레트(B).
 *
 * STRUCTURES 레지스트리를 순회한다. 건물을 추가해도 숫자키가 하나 늘 뿐이다.
 */
import { BUILDABLE, STRUCTURES, type NetPlayer, type StructureId } from '@gojijeon/shared';
import { chip, clear, el, setShown } from './dom';

export class BuildPalette {
  readonly root = el('div', { class: 'panel', id: 'build' });
  private signature = '';

  constructor(private readonly onSelect: (s: StructureId) => void) {
    this.root.style.position = 'absolute';
    this.root.style.left = '50%';
    this.root.style.bottom = '64px';
    this.root.style.transform = 'translateX(-50%)';
    this.root.style.padding = '10px 12px';
    setShown(this.root, false);
  }

  pick(n: number): StructureId | null {
    return n >= 1 && n <= BUILDABLE.length ? BUILDABLE[n - 1] : null;
  }

  update(me: NetPlayer | null, selected: StructureId, visible: boolean): void {
    setShown(this.root, visible);
    if (!visible) return;

    const ore = me ? me.ore : 0;
    const shard = me ? me.shard : 0;
    const sig = `${ore}/${shard}/${selected}`;
    if (sig === this.signature) return;
    this.signature = sig;

    clear(this.root);
    this.root.append(el('div', { class: 'muted', text: '건설 — 망치를 든 채로 좌클릭. 숫자키로 고른다' }));
    const row = el('div', { class: 'chips' });
    BUILDABLE.forEach((id, i) => {
      const def = STRUCTURES[id];
      row.append(
        chip(
          {
            key: String(i + 1),
            name: def.name,
            color: def.color,
            cost: `광석 ${def.cost.ore}${def.cost.shard ? ` · 조각 ${def.cost.shard}` : ''}`,
            enabled: ore >= def.cost.ore && shard >= def.cost.shard,
            selected: selected === id,
            hint: def.blurb,
          },
          () => this.onSelect(id),
        ),
      );
    });
    this.root.append(row);
  }
}
