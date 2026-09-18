/**
 * 전리품 안내판(C).
 *
 * 무기를 만드는 화면이 아니라 **어디서 나오는지 알려주는 화면**이다.
 * "제작 버튼이 왜 없지?"를 한 번에 없애려고 둔다.
 *
 * 목록은 LOOT_POOL을 그대로 순회한다. 무기가 늘면 항목도 따라 늘고,
 * dropWeight만 바꿔도 여기 숫자가 맞춰 움직인다.
 */
import { LOOT, LOOT_POOL, RESOURCE, STRUCTURES, lootOdds } from '@gojijeon/shared';
import { weaponIcon } from './weaponIcon';
import { el, setShown } from './dom';

const RARITY_LABEL: Record<string, string> = {
  common: '흔함',
  uncommon: '드묾',
  rare: '희귀',
};

export class LootPanel {
  readonly root = el('div', { class: 'panel', id: 'loot' });
  private built = false;

  constructor() {
    this.root.style.position = 'absolute';
    this.root.style.left = '50%';
    this.root.style.bottom = '64px';
    this.root.style.transform = 'translateX(-50%)';
    this.root.style.padding = '10px 12px';
    setShown(this.root, false);
  }

  update(visible: boolean): void {
    setShown(this.root, visible);
    if (!visible || this.built) return;
    this.built = true;

    const pct = (v: number): string => `${Math.round(v * 100)}%`;
    this.root.append(
      el('div', { text: '무기는 만들 수 없다. 땅에서 나온다.' }),
      el('div', {
        class: 'muted',
        text:
          `흙벽 ${pct(LOOT.softWallChance)} · 광맥 ${pct(LOOT.oreVeinChance)} 확률로 드랍 · ` +
          '죽은 사람도 들고 있던 걸 떨군다',
      }),
    );

    const odds = new Map(lootOdds().map((o) => [o.id, o.percent]));
    const row = el('div', { class: 'chips' });
    for (const def of LOOT_POOL) {
      // 이름만으로는 뭘 줍는지 안 그려진다. 바닥·손에 붙는 그림을 그대로 쓴다.
      const icon = weaponIcon(20);
      icon.set(def.id, def.color);
      row.append(
        el('div', { class: 'chip', title: def.blurb }, [
          icon.node,
          el('span', { text: def.name }),
          el('span', {
            class: 'cost',
            text: `${RARITY_LABEL[def.rarity] ?? def.rarity} ${Math.round(odds.get(def.id) ?? 0)}%`,
          }),
        ]),
      );
    }
    this.root.append(row);

    this.root.append(
      el('div', {
        class: 'muted',
        text:
          `구급품은 뚫은 칸에서 ${pct(LOOT.healthChance)} 확률로 따로 나온다(+${RESOURCE.healthAmount} 회복). ` +
          '체력이 가득하면 줍지 않고 바닥에 남으므로, 다친 뒤 되돌아가면 된다.',
      }),
      el('div', {
        class: 'muted',
        text:
          `광석은 벽·문·화톳불에 쓴다. ${STRUCTURES.turret.name}만 코어 조각을 요구하고, ` +
          '조각은 적을 죽이거나 맵 중앙을 점령해야 나온다.',
      }),
    );
  }
}
