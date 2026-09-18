/**
 * 아바타 식별 표식.
 *
 * 모두가 같은 원이면 난전에서 자기 자신을 잃어버린다. 에셋 없이 도형만으로
 * 두 가지를 구분한다.
 *  - "나"인가: 흰 링 + 머리 위 삼각형 마커(둘 다 있어야 눈에 걸린다).
 *  - 같은 팀 안에서 누구인가: id에서 결정적으로 뽑은 무늬.
 * 무늬는 id만으로 정해지므로 같은 사람은 매 판 같은 무늬를 갖는다.
 */
import { PLAYER, type PlayerId } from '@gojijeon/shared';
import { shade } from './colors';
import { VIS } from './visualConfig';

/** 무늬 종류 수. 한 팀 정원보다 넉넉해야 같은 팀에서 겹치지 않는다. */
const GLYPH_KINDS = 8;

/**
 * id → 무늬 번호.
 * 서버 id는 0,1,2…로 촘촘히 붙으므로 섞지 않으면 옆 사람과 비슷한 무늬가 걸린다.
 */
export const glyphOf = (id: PlayerId): number =>
  (Math.imul(id + 1, 2654435761) >>> 0) % GLYPH_KINDS;

/** 원 안에 찍는 무늬. 팀색을 밝게 올려 칠해 팀 소속도 같이 읽히게 한다. */
export const drawAvatarPattern = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  teamHex: string,
  id: PlayerId,
): void => {
  const kind = glyphOf(id);
  const r = PLAYER.radius * 0.52;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = shade(teamHex, 1.9);
  ctx.strokeStyle = shade(teamHex, 1.9);
  ctx.lineWidth = 1.6;

  if (kind < 4) drawDots(ctx, kind + 1, r);
  else drawPolygon(ctx, kind, r);

  ctx.restore();
};

/** 1~4개의 점. 세는 데 시간이 걸리지 않는 배치로만 둔다. */
const drawDots = (ctx: CanvasRenderingContext2D, n: number, r: number): void => {
  const d = r * 0.9;
  const spots: ReadonlyArray<readonly [number, number]> =
    n === 1 ? [[0, 0]]
      : n === 2 ? [[-d, 0], [d, 0]]
        : n === 3 ? [[0, -d], [-d, d * 0.7], [d, d * 0.7]]
          : [[-d, -d], [d, -d], [-d, d], [d, d]];
  for (const [ox, oy] of spots) {
    ctx.beginPath();
    ctx.arc(ox, oy, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }
};

/** 삼각·사각·마름모·별. 점 세기와 섞여도 서로 헷갈리지 않는 실루엣들. */
const drawPolygon = (ctx: CanvasRenderingContext2D, kind: number, r: number): void => {
  const sides = kind === 4 ? 3 : kind === 7 ? 5 : 4;
  // 같은 사각형이라도 45도 돌리면 '네모'와 '마름모'로 따로 읽힌다.
  const rot = kind === 5 ? Math.PI / 4 : -Math.PI / 2;
  const spiky = kind === 7;

  ctx.beginPath();
  const steps = spiky ? sides * 2 : sides;
  for (let i = 0; i < steps; i++) {
    const rad = spiky && i % 2 === 1 ? r * 0.45 : r;
    const a = rot + (i / steps) * Math.PI * 2;
    const px = Math.cos(a) * rad;
    const py = Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
};

/** 내 캐릭터 둘레의 링. 난전에서 놓치지 않도록 상태와 무관하게 항상 그린다. */
export const drawSelfRing = (ctx: CanvasRenderingContext2D, x: number, y: number): void => {
  const { ringGap, ringWidth } = VIS.self;
  ctx.lineWidth = ringWidth;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.arc(x, y, PLAYER.radius + ringGap, 0, Math.PI * 2);
  ctx.stroke();

  // 흰 링만으로는 밝은 타일 위에서 묻힌다. 바깥에 노란 테를 한 겹 더 두른다.
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(250,204,21,0.75)';
  ctx.beginPath();
  ctx.arc(x, y, PLAYER.radius + ringGap + ringWidth, 0, Math.PI * 2);
  ctx.stroke();
};

/** 머리 위에서 아래를 가리키는 삼각형. 천천히 위아래로 흔들려 시선을 끈다. */
export const drawSelfMarker = (ctx: CanvasRenderingContext2D, x: number, y: number, nowMs: number): void => {
  const { markerSize, markerGap, bobAmp, bobPeriodMs } = VIS.self;
  const bob = Math.sin((nowMs / bobPeriodMs) * Math.PI * 2) * bobAmp;
  const tip = y - PLAYER.radius - markerGap + bob;

  ctx.beginPath();
  ctx.moveTo(x, tip);
  ctx.lineTo(x - markerSize * 0.6, tip - markerSize);
  ctx.lineTo(x + markerSize * 0.6, tip - markerSize);
  ctx.closePath();
  ctx.fillStyle = '#facc15';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.stroke();
};
