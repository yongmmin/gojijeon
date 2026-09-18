/**
 * DOM용 무기 아이콘.
 *
 * 캔버스와 **같은 SVG**를 쓴다 — 손에 든 그림과 목록의 그림이 다르면
 * "내가 지금 뭘 들었나"를 두 번 배워야 한다. DOM은 래스터화가 필요 없어서
 * data URL을 <img>에 그대로 물린다.
 *
 * 그림이 없는 무기는 예전처럼 색 견본으로 떨어진다(폴백은 지우지 않는다).
 */
import type { WeaponId } from '@gojijeon/shared';
import { weaponIconUrl } from '../render/weaponSprites';
import { el } from './dom';

export interface WeaponIcon {
  readonly node: HTMLElement;
  set(id: WeaponId | null, color: string | null): void;
}

/** @param px 아이콘 한 변. 칩 안에서는 작게, HUD 손 표시에서는 크게 쓴다. */
export const weaponIcon = (px = 16): WeaponIcon => {
  const img = el('img');
  const swatch = el('span', { class: 'sw' });
  const node = el('span', {}, [img, swatch]);

  node.style.display = 'inline-flex';
  node.style.alignItems = 'center';
  node.style.flex = 'none';
  img.style.width = `${px}px`;
  img.style.height = `${px}px`;
  img.style.objectFit = 'contain';
  img.style.display = 'none';
  swatch.style.width = `${Math.round(px * 0.7)}px`;
  swatch.style.height = `${Math.round(px * 0.7)}px`;
  swatch.style.border = '1px solid';
  swatch.style.borderRadius = '2px';
  // span은 기본이 inline이라 폭·높이가 먹지 않는다. 폴백 견본이 사라지는 걸 막는다.
  swatch.style.display = 'none';
  const SWATCH_SHOWN = 'inline-block';

  return {
    node,
    set(id, color) {
      const url = id ? weaponIconUrl(id) : null;
      img.style.display = url ? '' : 'none';
      swatch.style.display = url ? 'none' : SWATCH_SHOWN;
      if (url && img.getAttribute('src') !== url) img.setAttribute('src', url);
      swatch.style.background = color ?? 'transparent';
      swatch.style.borderColor = color ?? 'rgba(255,255,255,.3)';
    },
  };
};
