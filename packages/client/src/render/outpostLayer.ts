/**
 * 고지(맵 한가운데의 상징물).
 *
 * 지형 레이어가 아니라 여기서 그린다 — 주인·진행도·경합이 매 틱 바뀌므로
 * 오프스크린에 구워 두는 지형 캐시와는 수명이 다르다.
 *
 * 그리는 것: 점령 반경 → 상징물 → 점령 게이지. 규칙은 전부 서버가 정하고
 * 이 파일은 NetOutpost에 담겨 온 값을 읽기만 한다.
 */
import { tileCenter, type NetOutpost } from '@gojijeon/shared';
import { shade, teamColor, withAlpha } from './colors';
import { OUTPOST_VIS as O } from './visualConfig';

/** 주인 색. 중립은 팀색과 절대 겹치지 않는 회색이어야 한다. */
export const outpostColor = (o: NetOutpost): string =>
  o.owner === null ? O.neutral : teamColor(o.owner);

/** 경합 중에는 점멸시켜 "지금 둘 다 있다"를 색이 아니라 움직임으로 알린다. */
const blinking = (nowMs: number): boolean =>
  Math.floor(nowMs / O.contestBlinkMs) % 2 === 0;

export const drawOutpost = (
  ctx: CanvasRenderingContext2D,
  o: NetOutpost,
  nowMs: number,
): void => {
  const cx = tileCenter(o.tx);
  const cy = tileCenter(o.ty);
  const owned = outpostColor(o);

  drawField(ctx, cx, cy, o, owned, nowMs);
  drawMonument(ctx, cx, cy, o, owned, nowMs);
  drawGauge(ctx, cx, cy, o, nowMs);
};

/** 점령 판정 반경. 서 있어야 하는 자리를 은은하게만 보여준다. */
const drawField = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  o: NetOutpost,
  color: string,
  nowMs: number,
): void => {
  const warn = o.contested && blinking(nowMs);
  ctx.fillStyle = withAlpha(warn ? O.contest : color, O.fieldAlpha);
  ctx.beginPath();
  ctx.arc(cx, cy, o.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = withAlpha(warn ? O.contest : color, 0.3);
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 7]);
  ctx.stroke();
  ctx.setLineDash([]);
};

/** 오벨리스크. 게임 이름이 여기서 나오므로 화면에서 제일 눈에 띄어야 한다. */
const drawMonument = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  o: NetOutpost,
  color: string,
  nowMs: number,
): void => {
  const w = O.monumentW;
  const h = O.monumentH;
  const base = cy + h * 0.32;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, base + 2, w * 0.95, w * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#0b0d12';
  ctx.lineWidth = 2;
  ctx.fillStyle = shade(color, 0.55);
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.9, base);
  ctx.lineTo(cx + w * 0.9, base);
  ctx.lineTo(cx + w * 0.6, base - 5);
  ctx.lineTo(cx - w * 0.6, base - 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 위로 좁아지는 탑. 주인 팀 색을 그대로 입혀 멀리서 소속이 읽힌다.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.5, base - 4);
  ctx.lineTo(cx + w * 0.5, base - 4);
  ctx.lineTo(cx + w * 0.22, cy - h * 0.62);
  ctx.lineTo(cx, cy - h * 0.78);
  ctx.lineTo(cx - w * 0.22, cy - h * 0.62);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.5, base - 4);
  ctx.lineTo(cx - w * 0.16, base - 4);
  ctx.lineTo(cx - w * 0.06, cy - h * 0.62);
  ctx.lineTo(cx - w * 0.22, cy - h * 0.62);
  ctx.closePath();
  ctx.fill();

  // 주인이 있으면 꼭대기가 숨 쉬듯 빛난다 — 점령된 상태가 정지 화면에서도 보인다.
  if (o.owner !== null) {
    const pulse = 0.55 + 0.45 * Math.sin(nowMs / 420);
    ctx.fillStyle = withAlpha(color, pulse);
    ctx.beginPath();
    ctx.arc(cx, cy - h * 0.82, 4 + pulse * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

/** 상징물 둘레를 도는 원형 진행바. 12시부터 시계방향으로 찬다. */
const drawGauge = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  o: NetOutpost,
  nowMs: number,
): void => {
  const r = O.gaugeRadius;
  ctx.save();
  ctx.lineWidth = O.gaugeWidth;
  ctx.lineCap = 'round';

  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  if (o.progress > 0 && o.capturing !== null) {
    const warn = o.contested && blinking(nowMs);
    ctx.strokeStyle = warn ? O.contest : teamColor(o.capturing);
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, o.progress));
    ctx.stroke();
  }

  if (o.contested) {
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = blinking(nowMs) ? O.contest : 'rgba(255,255,255,0.65)';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 3;
    ctx.strokeText('경합', cx, cy + r + 10);
    ctx.fillText('경합', cx, cy + r + 10);
  }
  ctx.restore();
};

/** 미니맵용. 중앙 한 칸이라 점 하나로는 안 보이므로 마름모로 키운다. `k`는 월드px→미니맵px 배율. */
export const drawOutpostMark = (
  ctx: CanvasRenderingContext2D,
  o: NetOutpost,
  x: number,
  y: number,
  k: number,
): void => {
  const cx = x + tileCenter(o.tx) * k;
  const cy = y + tileCenter(o.ty) * k;
  const s = O.minimapMark;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = outpostColor(o);
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 1.5;
  ctx.fillRect(-s / 2, -s / 2, s, s);
  ctx.strokeRect(-s / 2, -s / 2, s, s);
  ctx.restore();
};
