/**
 * 무기 스프라이트.
 *
 * 래스터화 자체는 spriteCache가 한다. 여기서는 무기 레지스트리(색)와 그림(weaponArt)을
 * 붙여 캐시 키를 만드는 일만 한다. 그림이 없는 무기는 null을 돌려주고, 부르는 쪽이
 * kind 폴백 도형으로 그린다.
 *
 * DOM(HUD·목록)은 래스터가 필요 없다. 같은 SVG의 data URL을 <img>에 그대로 물린다.
 */
import { WEAPONS, type WeaponId } from '@gojijeon/shared';
import { drawSprite, rasterize, svgDataUrl, type DrawOpts, type SpriteSource } from './spriteCache';
import { WEAPON_ART, weaponSvg, type WeaponArt } from './weaponArt';

/** 당긴 자세가 없는 무기는 대기 자세로 되돌린다 — 같은 그림을 두 번 굽지 않는다. */
const variantOf = (art: WeaponArt, pulled: boolean): boolean => pulled && art.pulled !== undefined;

const keyOf = (id: WeaponId, pulled: boolean): string => `w:${id}${pulled ? ':pulled' : ''}`;

const sourceOf = (id: WeaponId, art: WeaponArt, pulled: boolean): SpriteSource => ({
  vw: art.vw, vh: art.vh, len: art.len, grip: art.grip,
  svg: weaponSvg(art, WEAPONS[id].color, pulled),
});

/** 첫 교전 전에 미리 구워 둔다. 늦어도 폴백이 나오지만 한 번 깜빡이는 것도 피한다. */
export const prewarmWeaponSprites = (): void => {
  for (const id of Object.keys(WEAPON_ART) as WeaponId[]) {
    const art = WEAPON_ART[id];
    if (!art) continue;
    rasterize(keyOf(id, false), sourceOf(id, art, false));
    if (art.pulled) rasterize(keyOf(id, true), sourceOf(id, art, true));
  }
};

/** HUD·목록용 아이콘 주소. 그림이 없는 무기는 null — 부르는 쪽이 색 견본으로 대체한다. */
export const weaponIconUrl = (id: WeaponId): string | null => {
  const art = WEAPON_ART[id];
  return art ? svgDataUrl(weaponSvg(art, WEAPONS[id].color, false)) : null;
};

/**
 * 그립을 (x, y)에 두고 `angle` 방향으로 눕혀 그린다.
 * 그림이 없거나 아직 안 구워졌으면 false — 폴백으로 넘어가면 된다.
 */
export const drawWeaponSprite = (
  ctx: CanvasRenderingContext2D,
  id: WeaponId,
  x: number,
  y: number,
  angle: number,
  opts: DrawOpts & { pulled?: boolean } = {},
): boolean => {
  const art = WEAPON_ART[id];
  if (!art) return false;
  const v = variantOf(art, opts.pulled ?? false);
  return drawSprite(ctx, keyOf(id, v), sourceOf(id, art, v), x, y, angle, opts);
};
