/**
 * 체력바 하나.
 *
 * 플레이어·건축물·코어가 같은 함수를 쓴다 — 같은 정보를 다른 모양으로 그리면
 * 난전에서 무엇의 체력인지 다시 읽어야 한다.
 */
import type { HitLook } from './hitFeedback';
import { HIT_VIS, VIS } from './visualConfig';

/**
 * 체력바. `hit`이 있으면 방금 깎여 나간 구간을 잔상으로 남겼다가 따라오게 한다 —
 * 줄어드는 과정이 보여야 "얼마나 들어갔는지"가 숫자 없이도 읽힌다.
 */
export const hpBar = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  w: number,
  ratio: number,
  hit?: HitLook,
): void => {
  const r = Math.max(0, Math.min(1, ratio));
  const boost = hit ? hit.emphasis * HIT_VIS.hpBarBoost : 0;
  const h = VIS.hpBarHeight + boost;
  const x = cx - w / 2;

  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x, y - boost / 2, w, h);
  if (hit && hit.ghostRatio > r) {
    ctx.fillStyle = hit.blocked ? '#93c5fd' : HIT_VIS.hpGhost;
    ctx.fillRect(x + w * r, y - boost / 2, w * (hit.ghostRatio - r), h);
  }
  ctx.fillStyle = r > 0.5 ? '#a3e635' : r > 0.25 ? '#fbbf24' : '#f87171';
  ctx.fillRect(x, y - boost / 2, w * r, h);
  // 밝은 지형 위에서도 바의 경계가 남아야 한다.
  ctx.strokeStyle = boost > 0.3 ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 0.5, y - boost / 2 - 0.5, w + 1, h + 1);
};
