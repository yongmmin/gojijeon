/**
 * 세워진 것들 — 건축물과 코어.
 *
 * 칸 자체는 지형 레이어가 이미 칠했다. 여기서는 매 틱 바뀌는 것(소속·체력·사거리)만
 * 그 위에 덧붙인다.
 */
import {
  STRUCTURES, TILE, tileCenter, tileXOf, tileYOf, type NetCore, type NetStructure,
} from '@gojijeon/shared';
import { shade, teamColor, withAlpha } from './colors';
import { hpBar } from './hpBar';

export const drawStructure = (ctx: CanvasRenderingContext2D, st: NetStructure): void => {
  const def = STRUCTURES[st.type];
  const x = tileXOf(st.tile) * TILE;
  const y = tileYOf(st.tile) * TILE;

  // 칸 자체는 지형 레이어가 칠했다. 여기서는 소속과 상태만 덧붙인다.
  ctx.strokeStyle = teamColor(st.team);
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);

  if (def.turret) {
    // 포탑은 한 판에 하나 설까 말까 한 물건이다. 사거리를 눈에 보이게 그려서
    // 세운 쪽도 마주친 쪽도 어디까지가 위험한지 바로 알게 한다.
    ctx.fillStyle = withAlpha(def.color, 0.07);
    ctx.beginPath();
    ctx.arc(x + TILE / 2, y + TILE / 2, def.turret.range, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade(def.color, 0.6);
    ctx.beginPath();
    ctx.arc(x + TILE / 2, y + TILE / 2, TILE * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
  if (def.heal) {
    ctx.fillStyle = withAlpha(def.color, 0.14);
    ctx.beginPath();
    ctx.arc(x + TILE / 2, y + TILE / 2, def.heal.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  if (st.hp < st.maxHp) hpBar(ctx, x + TILE / 2, y - 6, TILE - 6, st.hp / st.maxHp);
};

export const drawCore = (ctx: CanvasRenderingContext2D, c: NetCore): void => {
  const size = TILE * 2;
  const cx = tileCenter(c.tx);
  const cy = tileCenter(c.ty);
  const col = teamColor(c.team);

  ctx.fillStyle = withAlpha(col, 0.18);
  ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
  ctx.strokeStyle = col;
  ctx.lineWidth = 3;
  ctx.strokeRect(cx - size / 2, cy - size / 2, size, size);
  ctx.fillStyle = col;
  ctx.fillRect(cx - size / 6, cy - size / 6, size / 3, size / 3);

  hpBar(ctx, cx, cy - size / 2 - 10, size, c.maxHp > 0 ? c.hp / c.maxHp : 0);
};

