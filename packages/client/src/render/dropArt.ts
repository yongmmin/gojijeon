/**
 * 구급품 그림.
 *
 * 체력이 가득하면 줍지 않고 바닥에 2분을 남는다 — 멀쩡할 때 지나쳤다가 다치고
 * 되돌아오는 것이 이 아이템의 요점이다. 그러려면 **멀리서 보이고, 기억에 남아야**
 * 하므로 무기·광석과 실루엣부터 다른 흰 케이스 + 붉은 십자로 그린다.
 */
import { PLAYER, TILES, Tile, WEAPONS, type DropKind, type NetDrop } from '@gojijeon/shared';
import type { Camera } from './camera';
import { withAlpha } from './colors';
import { drawWeaponSprite } from './weaponSprites';
import { drawSprite, type SpriteSource } from './spriteCache';
import { HEALTH_VIS, MATERIAL as M, WEAPON_VIS } from './visualConfig';

/** 자원 드롭 색도 레지스트리에서 끌어온다 — 광석은 광맥 색, 조각은 노드 색. */
const DROP_COLOR: Record<DropKind, string> = {
  weapon: '#ffffff',
  ore: TILES[Tile.ORE_VEIN].color,
  shard: TILES[Tile.SHARD_NODE].color,
  health: HEALTH_VIS.cross,
};

const VW = 64;
const VH = 56;

const svg = (): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}" width="${VW}" height="${VH}">` +
  `<g stroke="${M.outline}" stroke-width="3" stroke-linejoin="round">` +
  `<rect x="4" y="10" width="56" height="42" rx="7" fill="${HEALTH_VIS.case}"/>` +
  // 손잡이가 있어야 "가방"으로 읽힌다. 알약이나 광석으로 오해할 여지를 줄인다.
  `<path d="M24 10 L24 5 L40 5 L40 10" fill="none" stroke-linecap="round"/>` +
  `<path d="M26 18 L38 18 L38 26 L46 26 L46 36 L38 36 L38 44 L26 44 L26 36 L18 36 L18 26 L26 26 Z" fill="${HEALTH_VIS.cross}"/>` +
  `</g>` +
  `<rect x="9" y="15" width="8" height="30" rx="4" fill="rgba(255,255,255,0.5)"/>` +
  `</svg>`;

const SOURCE: SpriteSource = {
  vw: VW, vh: VH, len: HEALTH_VIS.sizePx, grip: [0.5, 0.5], svg: svg(),
};

/** 맥동은 눈길을 끌기 위한 것이다 — 규칙과는 아무 관계가 없다. */
const pulseOf = (nowMs: number, phase: number): number =>
  0.5 + 0.5 * Math.sin((nowMs / HEALTH_VIS.pulseMs) * Math.PI * 2 + phase);

export const drawHealthDrop = (ctx: CanvasRenderingContext2D, d: NetDrop, nowMs: number): void => {
  const pulse = pulseOf(nowMs, d.id * 0.9);
  const bob = (pulse - 0.5) * 2 * HEALTH_VIS.bobPx;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(d.x, d.y + 7, 8, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // 후광이 숨 쉬듯 커졌다 작아진다. 어두운 땅굴에서 이게 없으면 그냥 흰 점이다.
  ctx.fillStyle = withAlpha(HEALTH_VIS.cross, 0.1 + 0.14 * pulse);
  ctx.beginPath();
  ctx.arc(d.x, d.y + bob, HEALTH_VIS.sizePx * (0.75 + 0.18 * pulse), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (drawSprite(ctx, 'drop:health', SOURCE, d.x, d.y + bob, 0)) return;

  // 아직 안 구워졌을 때. 십자 하나면 무엇인지는 전달된다.
  ctx.save();
  ctx.fillStyle = HEALTH_VIS.case;
  ctx.fillRect(d.x - 6, d.y + bob - 5, 12, 10);
  ctx.fillStyle = HEALTH_VIS.cross;
  ctx.fillRect(d.x - 1.5, d.y + bob - 3.5, 3, 7);
  ctx.fillRect(d.x - 4.5, d.y + bob - 1.5, 9, 3);
  ctx.restore();
};

/**
 * 다쳤을 때만, 화면 밖에 있는 가장 가까운 구급품 방향을 가장자리에 찍는다.
 * 멀쩡할 때도 띄우면 화면이 화살표로 뒤덮이므로 조건을 좁게 잡았다.
 */
export const drawHealthCompass = (
  ctx: CanvasRenderingContext2D,
  drops: readonly NetDrop[],
  me: { x: number; y: number; hp: number },
  cam: Camera,
  viewW: number,
  viewH: number,
  nowMs: number,
): void => {
  if (me.hp >= PLAYER.maxHp) return;

  let best: NetDrop | null = null;
  let bestD2 = HEALTH_VIS.compassRange ** 2;
  for (const d of drops) {
    if (d.kind !== 'health') continue;
    // 화면 안에 있으면 눈으로 보면 된다. 가리키는 건 안 보이는 것만.
    const onScreen =
      d.x > cam.left && d.x < cam.left + viewW && d.y > cam.top && d.y < cam.top + viewH;
    if (onScreen) continue;
    const d2 = (d.x - me.x) ** 2 + (d.y - me.y) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = d;
    }
  }
  if (!best) return;

  const a = Math.atan2(best.y - me.y, best.x - me.x);
  const cx = viewW / 2;
  const cy = viewH / 2;
  const r = Math.min(cx, cy) - HEALTH_VIS.compassInset;
  const x = cx + Math.cos(a) * r;
  const y = cy + Math.sin(a) * r;
  const pulse = pulseOf(nowMs, 0);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.globalAlpha = 0.45 + 0.35 * pulse;
  ctx.fillStyle = HEALTH_VIS.cross;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(9, 0);
  ctx.lineTo(-6, -6);
  ctx.lineTo(-6, 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
};

/**
 * 바닥의 전리품. 무기는 손에 들었을 때와 **같은 그림**으로 그린다 —
 * 멀리서 "저건 창이다, 곡괭이 버리고 가자"가 성립해야 주우러 갈 이유가 생긴다.
 */
export const drawDrop = (ctx: CanvasRenderingContext2D, d: NetDrop, nowMs: number): void => {
  if (d.kind === 'health') {
    drawHealthDrop(ctx, d, nowMs);
    return;
  }
  if (d.kind !== 'weapon') {
    ctx.fillStyle = DROP_COLOR[d.kind];
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.kind === 'shard' ? 4 : 3, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // 흔들리지 않으면 바닥 무늬에 묻힌다. 드롭 id로 위상을 어긋내 여러 개가 같이 뛰지 않게.
  const phase = d.id * 0.7;
  const bob = Math.sin(nowMs / WEAPON_VIS.dropBobMs * Math.PI * 2 + phase) * WEAPON_VIS.dropBobPx;
  const spin = (nowMs / WEAPON_VIS.dropSpinMs) * Math.PI * 2 + phase;
  const color = d.weapon ? WEAPONS[d.weapon].color : DROP_COLOR.weapon;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(d.x, d.y + 6, 9, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = withAlpha(color, 0.16);
  ctx.beginPath();
  ctx.arc(d.x, d.y + bob, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const drawn = d.weapon !== null &&
    drawWeaponSprite(ctx, d.weapon, d.x, d.y + bob, spin, { scale: WEAPON_VIS.dropScale });
  if (drawn) return;

  // 스프라이트가 아직 안 구워졌거나 그림 없는 무기 — 예전 마름모로 버틴다.
  ctx.save();
  ctx.translate(d.x, d.y + bob);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = color;
  ctx.fillRect(-6, -6, 12, 12);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(-6, -6, 12, 12);
  ctx.restore();
};
