/**
 * 타일 질감.
 *
 * 색은 이미 "따뜻하면 팔 수 있다"로 갈려 있다. 질감은 그 위에 한 겹 더 얹어
 * **쳐도 소용없는 벽**을 색 없이도 알아보게 하는 것이 목적이다. 그래서 세게
 * 그리지 않는다 — 맵의 대부분이 흙벽이라 무늬가 진하면 눈이 먼저 지친다.
 *
 * 무늬는 **타일 인덱스로 결정된다**. 매 프레임 난수를 쓰면 가만히 있는 벽이
 * 지글거린다. 여기서 만든 무늬는 tileLayer의 오프스크린에 한 번 구워지고,
 * 그 칸이 바뀔 때만 다시 그려진다.
 *
 * texture 분기는 이 파일 하나에만 있다. 모르는 값은 flat으로 떨어지므로
 * shared에 질감을 새로 추가해도 화면이 비지 않는다.
 */
import { TILE, type TileDef } from '@gojijeon/shared';
import { shade, shadeAlpha } from './colors';

/** 인덱스 하나에서 서로 무관해 보이는 값 여러 개를 뽑는다. */
const hash = (idx: number, salt: number): number =>
  (Math.imul(idx + 1, 2654435761) ^ Math.imul(salt + 1, 40503)) >>> 0;

const unit = (idx: number, salt: number): number => (hash(idx, salt) % 1024) / 1024;

export const paintTexture = (
  ctx: CanvasRenderingContext2D,
  texture: TileDef['texture'],
  x: number,
  y: number,
  idx: number,
  base: string,
): void => {
  switch (texture) {
    case 'dirt': return dirt(ctx, x, y, idx);
    case 'stone': return stone(ctx, x, y, idx, base);
    case 'ore': return ore(ctx, x, y, idx, base);
    case 'energy': return energy(ctx, x, y, base);
    default: return;
  }
};

/** 오돌토돌한 점. 부술 수 있게 생겨야 한다. */
const dirt = (ctx: CanvasRenderingContext2D, x: number, y: number, idx: number): void => {
  for (let i = 0; i < 5; i++) {
    const px = x + 3 + unit(idx, i) * (TILE - 6);
    const py = y + 3 + unit(idx, i + 8) * (TILE - 6);
    const r = 1 + unit(idx, i + 16) * 1.4;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.07)';
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
};

/**
 * 딱딱한 사선 빗금 + 밝은 위 가장자리.
 * 흙의 둥근 점과 정반대의 직선이어야 "여기는 다른 재질"로 읽힌다.
 */
const stone = (ctx: CanvasRenderingContext2D, x: number, y: number, idx: number, base: string): void => {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, TILE, TILE);
  ctx.clip();

  ctx.strokeStyle = shade(base, 0.72);
  ctx.lineWidth = 2;
  ctx.beginPath();
  // 시작점만 칸마다 어긋내면 빗금이 이어지지 않아 벽면이 평평해 보이지 않는다.
  const off = unit(idx, 3) * TILE;
  for (let d = -TILE + off; d < TILE * 2; d += 11) {
    ctx.moveTo(x + d, y + TILE);
    ctx.lineTo(x + d + TILE, y);
  }
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(x, y, TILE, 3);
  ctx.restore();
};

/** 박힌 알갱이. 팔 값어치가 있다는 표시라 밝게. */
const ore = (ctx: CanvasRenderingContext2D, x: number, y: number, idx: number, base: string): void => {
  const bright = shade(base, 1.55);
  for (let i = 0; i < 3; i++) {
    const px = x + 6 + unit(idx, i + 2) * (TILE - 12);
    const py = y + 6 + unit(idx, i + 11) * (TILE - 12);
    const r = 2 + unit(idx, i + 21) * 1.6;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.arc(px, py, r + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = bright;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
};

/**
 * 빛나는 것. 여기 구워지는 건 정지한 안쪽 광채뿐이고,
 * **맥동은 tileLayer가 매 프레임 덧칠한다**(오프스크린에는 시간이 없다).
 */
const energy = (ctx: CanvasRenderingContext2D, x: number, y: number, base: string): void => {
  const cx = x + TILE / 2;
  const cy = y + TILE / 2;
  // 칸을 꽉 채우면 빛나는 원의 벽이 되어 한 칸씩 세는 것조차 힘들다. 가운데만 살짝.
  const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, TILE * 0.38);
  g.addColorStop(0, shadeAlpha(base, 1.45, 0.55));
  g.addColorStop(1, shadeAlpha(base, 1.45, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, TILE, TILE);
};

/** 화면에 보이는 energy 칸 위에 매 프레임 얹는 숨. 정적인 캐시로는 낼 수 없는 유일한 것. */
export const energyPulse = (nowMs: number): number =>
  0.02 + 0.06 * (0.5 + 0.5 * Math.sin((nowMs / 1500) * Math.PI * 2));
