/**
 * 붕괴 구역.
 *
 * 밖에 있으면 초당 피해가 들어온다. **보이지 않는 피해는 버그로 보인다** —
 * 이 파일이 없으면 플레이어는 영문도 모르고 죽는다. 그래서 세 겹으로 알린다:
 * 월드의 경계 원, 화면 가장자리 경고, 미니맵의 원.
 *
 * 경고색은 피격(붉은색)과 **반드시 달라야** 한다. 둘 다 붉으면 "맞고 있는 건지
 * 구역 밖인지"를 구분할 수 없고, 대처가 정반대다(싸운다 vs 달린다).
 * 색은 자홍, 무늬는 빗금 — 색맹이어도 무늬로 갈린다.
 */
import { TILE } from '@gojijeon/shared';
import type { Camera } from './camera';
import { withAlpha } from './colors';
import { ZONE_VIS as Z } from './visualConfig';

/** 프로토콜의 NetZone에서 실제로 필요한 것만. 테스트·하네스가 쉽게 만들 수 있다. */
export interface ZoneView {
  x: number;
  y: number;
  radius: number;
  shrinking: boolean;
}

export const outsideZone = (x: number, y: number, zone: ZoneView): boolean =>
  Math.hypot(x - zone.x, y - zone.y) > zone.radius;

/** 좁아지는 중에는 경계가 숨 쉰다. 멈춰 있을 때와 같게 그리면 지금 줄고 있는지 모른다. */
const pulse = (nowMs: number): number => 0.5 + 0.5 * Math.sin((nowMs / Z.pulseMs) * Math.PI * 2);

/** 카메라 변환이 걸린 상태에서 호출한다(월드 좌표). */
export const drawZone = (
  ctx: CanvasRenderingContext2D,
  zone: ZoneView,
  cam: Camera,
  nowMs: number,
): void => {
  const p = zone.shrinking ? pulse(nowMs) : 0;

  ctx.save();
  // 바깥만 덮는다. 사각형과 원을 한 경로에 넣고 evenodd로 칠하면 원이 구멍이 된다.
  ctx.beginPath();
  ctx.rect(cam.left - TILE, cam.top - TILE, cam.viewW + TILE * 2, cam.viewH + TILE * 2);
  ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2, true);
  ctx.fillStyle = withAlpha(Z.color, Z.outsideAlpha + Z.outsideAlpha * 0.5 * p);
  ctx.fill('evenodd');

  // 경계선. 안쪽으로 한 겹 더 두꺼운 빛을 깔아 "선"이 아니라 "벽"으로 읽히게 한다.
  ctx.strokeStyle = withAlpha(Z.color, 0.2 + 0.25 * p);
  ctx.lineWidth = Z.glowWidth;
  ctx.beginPath();
  ctx.arc(zone.x, zone.y, Math.max(0, zone.radius - Z.glowWidth / 2), 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = withAlpha(Z.color, 0.75 + 0.25 * p);
  ctx.lineWidth = Z.edgeWidth + (zone.shrinking ? 2 * p : 0);
  // 좁아지는 중에는 빗금이 돌아 "움직이고 있다"가 정지 화면에서도 보인다.
  if (zone.shrinking) {
    ctx.setLineDash(Z.dash);
    ctx.lineDashOffset = -(nowMs / 22) % 1000;
  }
  ctx.beginPath();
  ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
};

/**
 * 내가 밖에 있을 때. 카메라 변환 **밖**(스크린 좌표)에서 호출한다.
 * 빗금 비네트 + 중심 방향 화살표 + 문구 — 셋 다 있어야 "당장 움직여라"로 읽힌다.
 */
export const drawZoneWarning = (
  ctx: CanvasRenderingContext2D,
  zone: ZoneView,
  meX: number,
  meY: number,
  viewW: number,
  viewH: number,
  nowMs: number,
): void => {
  const p = pulse(nowMs);
  const cx = viewW / 2;
  const cy = viewH / 2;

  ctx.save();
  // 가장자리만 물들인다. 가운데까지 덮으면 정작 어디로 뛸지 안 보인다.
  const r = Math.hypot(viewW, viewH) / 2;
  const g = ctx.createRadialGradient(cx, cy, r * 0.34, cx, cy, r);
  g.addColorStop(0, withAlpha(Z.color, 0));
  g.addColorStop(1, withAlpha(Z.color, Z.warnAlpha * (0.65 + 0.35 * p)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, viewW, viewH);
  ctx.restore();

  // 위아래 띠에만 빗금. 피격 비네트(매끈한 붉은 그라데이션)와 무늬로도 갈리게 한다.
  const drift = (nowMs / 26) % (Z.stripeGap * 2);
  stripeBand(ctx, 0, viewW, Z.stripeBand, viewH, drift, 0.3 + 0.2 * p);
  stripeBand(ctx, viewH - Z.stripeBand, viewW, Z.stripeBand, viewH, drift, 0.3 + 0.2 * p);

  // 중심 방향. 어디로 뛰어야 하는지가 글자보다 먼저 읽혀야 한다.
  ctx.save();
  ctx.translate(cx, cy - Z.arrowLift);
  ctx.rotate(Math.atan2(zone.y - meY, zone.x - meX));
  ctx.fillStyle = Z.color;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(Z.arrowSize, 0);
  ctx.lineTo(-Z.arrowSize * 0.6, -Z.arrowSize * 0.7);
  ctx.lineTo(-Z.arrowSize * 0.2, 0);
  ctx.lineTo(-Z.arrowSize * 0.6, Z.arrowSize * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // 문구는 화살표 위로. 내 캐릭터(화면 한가운데)를 글자로 가리면 안 된다.
  ctx.save();
  ctx.font = Z.warnFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.fillStyle = '#ffffff';
  const ty = cy - Z.arrowLift - Z.textRise;
  ctx.strokeText(Z.warnText, cx, ty);
  ctx.fillText(Z.warnText, cx, ty);
  ctx.restore();
};

/** 화면 위·아래 띠 하나에만 흐르는 빗금을 친다. */
const stripeBand = (
  ctx: CanvasRenderingContext2D,
  top: number,
  viewW: number,
  bandH: number,
  span: number,
  drift: number,
  alpha: number,
): void => {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, top, viewW, bandH);
  ctx.clip();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = Z.color;
  ctx.lineWidth = Z.stripeWidth;
  ctx.beginPath();
  for (let d = -span + drift; d < viewW + span; d += Z.stripeGap * 2) {
    ctx.moveTo(d, top + bandH);
    ctx.lineTo(d + bandH, top);
  }
  ctx.stroke();
  ctx.restore();
};

/** 미니맵. 어디로 가야 하는지 판단하는 주 수단이라 반드시 있어야 한다. */
export const drawZoneMark = (
  ctx: CanvasRenderingContext2D,
  zone: ZoneView,
  x: number,
  y: number,
  k: number,
): void => {
  ctx.save();
  ctx.strokeStyle = withAlpha(Z.color, 0.9);
  ctx.lineWidth = 1.5;
  ctx.setLineDash(zone.shrinking ? [3, 3] : []);
  ctx.beginPath();
  ctx.arc(x + zone.x * k, y + zone.y * k, zone.radius * k, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
};
