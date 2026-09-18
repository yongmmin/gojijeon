/**
 * 지형 레이어.
 *
 * 맵은 128×128 = 16384칸이다. 매 프레임 전부 도는 것은 낭비이므로 오프스크린 캔버스에
 * 한 번 그려두고, 서버가 알려준 바뀐 칸만 덧그린다. 화면에는 보이는 사각형만 복사한다.
 */
import { MAP_TILES, STRUCTURES, TILE, TILES, Tile, tileXOf, tileYOf, type TileId } from '@gojijeon/shared';
import type { ClientWorld } from '../net/clientWorld';
import type { Camera } from './camera';
import { shade, withAlpha } from './colors';
import { energyPulse, paintTexture } from './tileTexture';
import { VIS } from './visualConfig';

export class TileLayer {
  private readonly canvas: HTMLCanvasElement = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private epoch = -1;
  /**
   * 빛나는 칸의 인덱스. 맥동은 시간이 들어가므로 오프스크린에 구울 수 없고,
   * 매 프레임 그 자리에만 덧칠한다. 봉쇄벽 한 줄과 노드 몇 칸뿐이라 비용은 없다.
   */
  private readonly energyTiles = new Map<number, string>();

  constructor() {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D 컨텍스트를 만들 수 없습니다');
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
  }

  /** 매 프레임 호출. 지형이 갈렸으면 전체, 아니면 바뀐 칸만 다시 그린다. */
  sync(world: ClientWorld): void {
    if (this.epoch !== world.mapEpoch) {
      this.epoch = world.mapEpoch;
      this.rebuild(world);
      return;
    }
    for (const idx of world.dirty) this.paint(world, idx);
  }

  /** 카메라 변환이 이미 적용된 컨텍스트에 보이는 부분만 복사한다. */
  draw(ctx: CanvasRenderingContext2D, cam: Camera, nowMs: number): void {
    const sx = Math.max(0, Math.floor(cam.left));
    const sy = Math.max(0, Math.floor(cam.top));
    const sw = Math.min(this.canvas.width - sx, Math.ceil(cam.viewW) + 2);
    const sh = Math.min(this.canvas.height - sy, Math.ceil(cam.viewH) + 2);
    if (sw <= 0 || sh <= 0) return;
    ctx.drawImage(this.canvas, sx, sy, sw, sh, sx, sy, sw, sh);
    this.drawEnergyPulse(ctx, cam, nowMs);
  }

  /** 봉쇄벽이 "곧 열릴 것"으로 보이려면 숨을 쉬어야 한다. 정지한 벽은 영구적으로 보인다. */
  private drawEnergyPulse(ctx: CanvasRenderingContext2D, cam: Camera, nowMs: number): void {
    if (this.energyTiles.size === 0) return;
    const alpha = energyPulse(nowMs);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const [idx, color] of this.energyTiles) {
      const x = tileXOf(idx) * TILE;
      const y = tileYOf(idx) * TILE;
      if (x + TILE < cam.left || x > cam.left + cam.viewW) continue;
      if (y + TILE < cam.top || y > cam.top + cam.viewH) continue;
      ctx.fillStyle = withAlpha(color, alpha);
      ctx.fillRect(x, y, TILE, TILE);
    }
    ctx.restore();
  }

  private rebuild(world: ClientWorld): void {
    this.energyTiles.clear();
    const n = world.mapTiles || MAP_TILES;
    const px = n * TILE;
    if (this.canvas.width !== px || this.canvas.height !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
    this.ctx.clearRect(0, 0, px, px);
    for (let i = 0; i < n * n; i++) this.paint(world, i);
  }

  private paint(world: ClientWorld, idx: number): void {
    const tx = tileXOf(idx);
    const ty = tileYOf(idx);
    const x = tx * TILE;
    const y = ty * TILE;
    const id = world.tiles[idx] as TileId;
    const def = TILES[id];
    const ctx = this.ctx;

    ctx.clearRect(x, y, TILE, TILE);
    // 봉쇄벽이 무너지면 그 칸의 맥동도 같이 사라져야 한다.
    if (def.texture === 'energy') this.energyTiles.set(idx, def.color);
    else this.energyTiles.delete(idx);

    if (id === Tile.EMPTY) {
      // 파낸 굴은 평평한 어둠이라 방향 감각이 사라진다. 옅은 체크무늬로 기준선을 준다.
      ctx.fillStyle = def.color;
      ctx.fillRect(x, y, TILE, TILE);
      if ((tx + ty) % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.016)';
        ctx.fillRect(x, y, TILE, TILE);
      }
      return;
    }

    const structure = id === Tile.STRUCTURE ? world.structures.get(idx) : undefined;
    const base = structure ? STRUCTURES[structure.type].color : def.color;

    ctx.fillStyle = base;
    ctx.fillRect(x, y, TILE, TILE);

    // 위쪽 밝게, 아래쪽 어둡게 — 벽이 세워져 있다는 느낌만 주는 최소한의 음영.
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x, y, TILE, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x, y + TILE - 3, TILE, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(x + TILE - 2, y, 2, TILE);

    // 색만으로도 팔 수 있는지는 갈리지만, 질감이 한 겹 더 있으면 "쳐도 소용없다"가
    // 색맹·어두운 모니터에서도 남는다. 무늬는 타일 인덱스로 결정되므로 지글거리지 않는다.
    paintTexture(ctx, def.texture, x, y, idx, base);

    // 건축물 피해는 개체 레이어의 HP 바가 보여준다. 여기서는 굴착 진행만 표시한다.
    if (structure || !def.mineable || def.hp <= 0) return;
    const hp = world.tileHp[idx];
    if (hp >= def.hp) return;
    const damage = 1 - Math.max(0, hp) / def.hp;
    ctx.fillStyle = `rgba(0,0,0,${(damage * VIS.mineOverlayAlpha).toFixed(3)})`;
    ctx.fillRect(x, y, TILE, TILE);
    this.paintCracks(x, y, damage, base);
  }

  /** 균열은 인덱스와 무관하게 같은 모양이어도 된다 — 진행도만 읽히면 된다. */
  private paintCracks(x: number, y: number, damage: number, base: string): void {
    const ctx = this.ctx;
    const steps = Math.min(3, Math.floor(damage * 4));
    if (steps <= 0) return;
    ctx.strokeStyle = shade(base, 0.45);
    ctx.lineWidth = 1;
    ctx.beginPath();
    const cx = x + TILE / 2;
    const cy = y + TILE / 2;
    for (let s = 0; s < steps; s++) {
      const a = (Math.PI * 2 * s) / 3 + 0.4;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * TILE * 0.45, cy + Math.sin(a) * TILE * 0.45);
    }
    ctx.stroke();
  }
}
