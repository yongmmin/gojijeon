/**
 * 카메라. 월드(픽셀) ↔ 화면(픽셀) 변환의 유일한 주인.
 *
 * 살아 있으면 내 캐릭터를 따라가고, 관전 중이면 자유 이동하거나 특정 플레이어를 붙잡는다.
 */
import { MAP_TILES, TILE, clamp } from '@gojijeon/shared';
import { VIS } from './visualConfig';

const WORLD_SIZE = MAP_TILES * TILE;

export class Camera {
  /** 화면 중앙이 보고 있는 월드 좌표. */
  x = WORLD_SIZE / 2;
  y = WORLD_SIZE / 2;
  viewW = 1;
  viewH = 1;
  /** 자유 이동 모드(관전). false면 대상 추적. */
  free = false;

  setViewport(w: number, h: number): void {
    this.viewW = w;
    this.viewH = h;
  }

  /** 추적 대상으로 부드럽게 붙는다. */
  follow(tx: number, ty: number, dtMs: number): void {
    const k = 1 - Math.exp((-VIS.cameraLerpPerSec * dtMs) / 1000);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
    this.clampToWorld();
  }

  /** 자유 이동(관전). dir은 -1..1. */
  pan(dx: number, dy: number, dtMs: number): void {
    const step = (VIS.freeCamSpeed * dtMs) / 1000;
    this.x += dx * step;
    this.y += dy * step;
    this.clampToWorld();
  }

  snapTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.clampToWorld();
  }

  /** 화면보다 맵이 작을 때는 중앙에 둔다 — 그렇지 않으면 경계에 붙인다. */
  private clampToWorld(): void {
    const halfW = this.viewW / 2;
    const halfH = this.viewH / 2;
    this.x = this.viewW >= WORLD_SIZE ? WORLD_SIZE / 2 : clamp(this.x, halfW, WORLD_SIZE - halfW);
    this.y = this.viewH >= WORLD_SIZE ? WORLD_SIZE / 2 : clamp(this.y, halfH, WORLD_SIZE - halfH);
  }

  get left(): number {
    return this.x - this.viewW / 2;
  }

  get top(): number {
    return this.y - this.viewH / 2;
  }

  screenToWorldX(sx: number): number {
    return this.left + sx;
  }

  screenToWorldY(sy: number): number {
    return this.top + sy;
  }

  /** 이후 그리는 모든 좌표를 월드 좌표로 다룰 수 있게 한다. restore는 호출자 몫. */
  apply(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(-Math.round(this.left), -Math.round(this.top));
  }
}

export const WORLD_PIXELS = WORLD_SIZE;
