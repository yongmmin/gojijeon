/**
 * 미니맵. 화면 우상단, 스크린 좌표에 그린다(카메라 변환 밖).
 *
 * 타일 한 칸 = 1픽셀짜리 오프스크린을 들고 있다가 확대해서 붙인다.
 * 지형 레이어와 같은 이유로 바뀐 칸만 덧칠한다.
 */
import { TILE, TILES, Tile, tileXOf, tileYOf, type TileId } from '@gojijeon/shared';
import type { ClientWorld } from '../net/clientWorld';
import type { Camera } from './camera';
import { teamColor } from './colors';
import { drawOutpostMark } from './outpostLayer';
import { drawZoneMark } from './zoneLayer';
import { HEALTH_VIS, VIS } from './visualConfig';

export class Minimap {
  private readonly canvas: HTMLCanvasElement = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private epoch = -1;

  constructor() {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D 컨텍스트를 만들 수 없습니다');
    this.ctx = ctx;
  }

  sync(world: ClientWorld): void {
    if (this.epoch !== world.mapEpoch) {
      this.epoch = world.mapEpoch;
      this.rebuild(world);
      return;
    }
    for (const idx of world.dirty) this.paint(world, idx);
  }

  /** 카메라 변환이 걸리지 않은 상태(스크린 좌표)에서 호출한다. */
  draw(ctx: CanvasRenderingContext2D, world: ClientWorld, cam: Camera, screenW: number): void {
    const { size, margin, alpha } = VIS.minimap;
    const x = screenW - size - margin;
    const y = margin;
    const worldPx = world.mapTiles * TILE;
    const k = size / worldPx;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(8,10,14,0.85)';
    ctx.fillRect(x, y, size, size);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.canvas, x, y, size, size);
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 1;

    const snap = world.snapshot;
    if (snap) {
      // 구역은 제일 먼저 — 어디로 가야 하는지를 판단하는 주 수단이라 다른 점에 가리면 안 된다.
      if (snap.zone) drawZoneMark(ctx, snap.zone, x, y, k);
      // 고지는 맵 중앙 한 칸이다. 코어보다 먼저 그려 겹치면 코어가 위로 오게 둔다.
      if (snap.outpost) drawOutpostMark(ctx, snap.outpost, x, y, k);
      // 구급품은 다치고 나서 되돌아가는 물건이라, 어디 있었는지가 미니맵에 남아야 한다.
      for (const d of snap.drops) {
        if (d.kind !== 'health') continue;
        ctx.fillStyle = HEALTH_VIS.cross;
        ctx.fillRect(x + d.x * k - 1.5, y + d.y * k - 0.5, 3, 1);
        ctx.fillRect(x + d.x * k - 0.5, y + d.y * k - 1.5, 1, 3);
      }
      for (const c of snap.cores) {
        ctx.fillStyle = teamColor(c.team);
        ctx.fillRect(x + c.tx * (size / world.mapTiles) - 2, y + c.ty * (size / world.mapTiles) - 2, 5, 5);
      }
      // 내 점은 마지막에 그려 남의 점 위로 올린다 — 겹쳤을 때 내가 가려지면 소용없다.
      const players = [...snap.players].sort((a, b) => Number(a.id === world.youId) - Number(b.id === world.youId));
      for (const p of players) {
        if (!p.alive) continue;
        const me = p.id === world.youId;
        ctx.fillStyle = me ? '#ffffff' : teamColor(p.team);
        ctx.beginPath();
        ctx.arc(x + p.x * k, y + p.y * k, me ? 4.5 : 2, 0, Math.PI * 2);
        ctx.fill();
        if (!me) continue;
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // 지금 보고 있는 범위. 관전 중 자유 카메라를 굴릴 때 방향 감각을 준다.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + cam.left * k, y + cam.top * k, cam.viewW * k, cam.viewH * k);

    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
    ctx.restore();
  }

  private rebuild(world: ClientWorld): void {
    const n = world.mapTiles;
    this.canvas.width = n;
    this.canvas.height = n;
    for (let i = 0; i < n * n; i++) this.paint(world, i);
  }

  private paint(world: ClientWorld, idx: number): void {
    const id = world.tiles[idx] as TileId;
    // 파낸 공간은 거의 검게 두고 벽만 보이게 해야 땅굴 모양이 읽힌다.
    this.ctx.fillStyle = id === Tile.EMPTY ? '#0e1117' : TILES[id].color;
    this.ctx.fillRect(tileXOf(idx), tileYOf(idx), 1, 1);
  }
}
