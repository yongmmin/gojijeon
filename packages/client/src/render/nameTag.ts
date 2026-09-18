/**
 * 캐릭터 머리 위 이름표.
 *
 * 맨 글씨는 흙·돌 위에서 그대로 묻힌다. 반투명 검은 알약을 깔고 그 위에 글씨를 얹는다.
 * 알약 폭은 매번 measureText로 재므로 이름 길이가 달라져도 어긋나지 않는다.
 */
import { VIS } from './visualConfig';

export interface NameTagStyle {
  /** 글자색. 팀전이면 팀색이 들어온다. */
  color: string;
  /** 전체 투명도. 싱글에서의 봇처럼 존재감을 낮출 때 쓴다. */
  alpha: number;
  /** 내 이름은 한 겹 더 강조한다. */
  emphasis: boolean;
}

export const drawNameTag = (
  ctx: CanvasRenderingContext2D,
  x: number,
  bottomY: number,
  text: string,
  style: NameTagStyle,
): void => {
  const { padX, padY, radius } = VIS.nameTag;
  ctx.save();
  ctx.globalAlpha = style.alpha;
  ctx.font = style.emphasis ? VIS.nameFontStrong : VIS.nameFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const w = ctx.measureText(text).width + padX * 2;
  const h = VIS.nameTag.height;
  const top = bottomY - h;

  roundRect(ctx, x - w / 2, top, w, h, radius);
  ctx.fillStyle = style.emphasis ? 'rgba(8,10,14,0.82)' : 'rgba(8,10,14,0.62)';
  ctx.fill();
  if (style.emphasis) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(250,204,21,0.8)';
    ctx.stroke();
  }

  // 알약 위에서도 글자 가장자리가 흐려지지 않도록 그림자를 한 겹 깐다.
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 2;
  ctx.fillStyle = style.color;
  ctx.fillText(text, x, top + h / 2 + padY * 0.1);
  ctx.restore();
};

const roundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void => {
  const rr = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
};
