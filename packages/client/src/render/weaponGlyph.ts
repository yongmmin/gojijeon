/**
 * 손에 든 무기를 화면에 얹는 곳.
 *
 * 그림(weaponArt) · 래스터(weaponSprites) · 동작(swingPose)을 조립하기만 한다.
 * 무기 id로 분기하지 않는다 — 스프라이트가 없으면 kind만 보고 도형으로 그리므로,
 * shared에 무기를 새로 넣어도 클라를 고치지 않고 일단 나온다. **이 폴백은 지우지 않는다.**
 */
import { PLAYER, type WeaponDef } from '@gojijeon/shared';
import { withAlpha } from './colors';
import type { SwingPose } from './swingPose';
import { WEAPON_VIS } from './visualConfig';
import { drawWeaponSprite } from './weaponSprites';

export interface HeldState {
  x: number;
  y: number;
  aim: number;
}

export const drawHeldWeapon = (
  ctx: CanvasRenderingContext2D,
  s: HeldState,
  def: WeaponDef,
  pose: SwingPose,
): void => {
  ctx.save();
  // 맞을 범위 예고는 판정과 같은 방향(aim)에 그려야 한다 — 휘두르는 그림만 흔들린다.
  if (pose.charge > 0 && def.kind === 'melee') {
    drawArcTelegraph(ctx, s, def.range, def.halfArc, def.color, pose.charge);
  }
  if (def.kind === 'ranged' && pose.charge > 0) drawAimLine(ctx, s, def, pose.charge);
  if (def.kind === 'throwable' && pose.charge > 0) drawThrowArc(ctx, s, def, pose.charge);
  if (pose.trail > 0) drawSlashTrail(ctx, s, def, pose);

  const angle = s.aim + pose.angle;
  const hand = PLAYER.radius + WEAPON_VIS.handGap + pose.reach;
  const hx = s.x + Math.cos(angle) * hand;
  const hy = s.y + Math.sin(angle) * hand;

  if (!drawWeaponSprite(ctx, def.id, hx, hy, angle, { pulled: pose.pull > 0.35 })) {
    drawFallbackShape(ctx, s, def, angle, hand);
  }
  ctx.restore();
};

/** 맞을 범위를 미리 보여주는 부채꼴. 피할 기회를 주는 것이 이 게임의 재미다. */
const drawArcTelegraph = (
  ctx: CanvasRenderingContext2D,
  s: HeldState,
  range: number,
  halfArc: number,
  color: string,
  p: number,
): void => {
  ctx.fillStyle = withAlpha(color, 0.08 + 0.16 * p);
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.arc(s.x, s.y, range, s.aim - halfArc, s.aim + halfArc);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = withAlpha(color, 0.25 + 0.35 * p);
  ctx.lineWidth = 1;
  ctx.stroke();
};

/** 통로 끝을 노린다는 사실 자체가 정보다. 시위를 당기는 동안에만 보여준다. */
const drawAimLine = (ctx: CanvasRenderingContext2D, s: HeldState, def: WeaponDef, p: number): void => {
  ctx.strokeStyle = withAlpha(def.color, 0.18 + 0.32 * p);
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(s.x + Math.cos(s.aim) * PLAYER.radius, s.y + Math.sin(s.aim) * PLAYER.radius);
  ctx.lineTo(s.x + Math.cos(s.aim) * def.range, s.y + Math.sin(s.aim) * def.range);
  ctx.stroke();
  ctx.setLineDash([]);
};

/** 폭탄이 어디까지 날아가는지. 자기 발밑에 터뜨리는 사고를 줄인다. */
const drawThrowArc = (ctx: CanvasRenderingContext2D, s: HeldState, def: WeaponDef, p: number): void => {
  ctx.strokeStyle = withAlpha(def.color, 0.35);
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(s.x + Math.cos(s.aim) * def.range * p, s.y + Math.sin(s.aim) * def.range * p);
  ctx.stroke();
  ctx.setLineDash([]);
};

/** 궤적 잔상. 한 겹이면 충분하다 — 이게 있고 없고가 타격감의 대부분이다. */
const drawSlashTrail = (
  ctx: CanvasRenderingContext2D,
  s: HeldState,
  def: WeaponDef,
  pose: SwingPose,
): void => {
  const inner = PLAYER.radius + 2;
  // 사거리를 그대로 쓰면 안 된다 — 폭탄의 range는 던지는 거리라 화면 절반이 잔상이 된다.
  // 잔상은 팔이 훑은 자리만큼만.
  const outer = Math.min(Math.max(inner + 6, def.range * 0.9), PLAYER.radius + 40);
  const from = s.aim + pose.trailFrom;
  const to = s.aim + pose.angle;
  const ccw = to < from;

  ctx.save();
  ctx.globalAlpha = pose.trail * 0.55;
  ctx.fillStyle = def.color;
  ctx.beginPath();
  ctx.arc(s.x, s.y, outer, from, to, ccw);
  ctx.arc(s.x, s.y, inner, to, from, !ccw);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = pose.trail * 0.9;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(s.x, s.y, outer, from, to, ccw);
  ctx.stroke();
  ctx.restore();
};

/**
 * 스프라이트가 아직 없거나 그림이 정의되지 않은 무기. kind와 레지스트리 수치만 읽는다.
 * 동작(angle/reach)은 스프라이트와 똑같이 먹으므로 폴백 상태에서도 휘두르는 게 보인다.
 */
const drawFallbackShape = (
  ctx: CanvasRenderingContext2D,
  s: HeldState,
  def: WeaponDef,
  angle: number,
  hand: number,
): void => {
  const ox = Math.cos(angle);
  const oy = Math.sin(angle);
  ctx.strokeStyle = def.color;
  ctx.fillStyle = def.color;
  ctx.lineCap = 'round';

  switch (def.kind) {
    case 'shield': {
      const half = def.block ? def.block.halfArc : Math.PI / 3;
      ctx.lineWidth = 5;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.arc(s.x, s.y, hand + 3, angle - half, angle + half);
      ctx.stroke();
      return;
    }
    case 'ranged': {
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(s.x + ox * hand * 0.8, s.y + oy * hand * 0.8, 9, angle - 1, angle + 1);
      ctx.stroke();
      return;
    }
    case 'throwable': {
      ctx.beginPath();
      ctx.arc(s.x + ox * hand, s.y + oy * hand, 5, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    default: {
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(s.x + ox * hand, s.y + oy * hand);
      ctx.lineTo(s.x + ox * (hand + def.range * 0.7), s.y + oy * (hand + def.range * 0.7));
      ctx.stroke();
    }
  }
};

/** 맨손. 주먹 하나만 표시해 "무장 해제 상태"가 즉시 읽히게 한다. */
export const drawBareHand = (ctx: CanvasRenderingContext2D, s: HeldState): void => {
  ctx.fillStyle = 'rgba(229,231,235,0.7)';
  ctx.beginPath();
  ctx.arc(
    s.x + Math.cos(s.aim) * (PLAYER.radius + 3),
    s.y + Math.sin(s.aim) * (PLAYER.radius + 3),
    3,
    0,
    Math.PI * 2,
  );
  ctx.fill();
};
