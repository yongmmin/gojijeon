/**
 * 카메라 변환 **밖**에 그리는 것들 — 화면에 고정된 겹.
 *
 * 여기서는 순서가 곧 우선순위다. 제일 급한 경고를 먼저 깔고, **미니맵을 맨 마지막에**
 * 그린다 — 구역 경고가 한창일 때가 정작 "어디로 뛰어야 하나"를 미니맵에서 읽어야
 * 하는 때라서, 경고 무늬가 미니맵을 덮으면 안 된다.
 */
import { PLAYER } from '@gojijeon/shared';
import type { ClientWorld } from '../net/clientWorld';
import type { Camera } from './camera';
import { drawHealthCompass } from './dropArt';
import type { Effects } from './effects';
import type { Minimap } from './minimap';
import { drawZoneWarning, outsideZone } from './zoneLayer';

export interface ScreenLayerDeps {
  world: ClientWorld;
  cam: Camera;
  minimap: Minimap;
  effects: Effects;
  viewW: number;
  viewH: number;
  nowMs: number;
}

export const drawScreenLayer = (ctx: CanvasRenderingContext2D, d: ScreenLayerDeps): void => {
  const { world, cam, viewW, viewH, nowMs } = d;
  const me = world.me;
  const snap = world.snapshot;

  d.effects.drawVignette(ctx, viewW, viewH, me ? me.hp / PLAYER.maxHp : 1, nowMs);

  const zone = snap?.zone;
  if (zone && me && me.alive && outsideZone(me.x, me.y, zone)) {
    drawZoneWarning(ctx, zone, me.x, me.y, viewW, viewH, nowMs);
  }
  if (snap && me && me.alive) {
    drawHealthCompass(ctx, snap.drops, me, cam, viewW, viewH, nowMs);
  }
  d.minimap.draw(ctx, world, cam, viewW);
};
