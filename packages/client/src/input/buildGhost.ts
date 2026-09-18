/**
 * 건설 미리보기.
 *
 * 대상 칸은 shared의 buildTargetTile을 그대로 호출한다 — 규칙을 클라에 베껴 적으면
 * 서버와 미리보기가 언젠가 반드시 어긋난다.
 * 가능/불가 판정은 canBuildAt이 World를 요구해서 그대로 쓸 수 없으므로 같은 조건을 확인한다.
 */
import {
  BUILDING, PLAYER, STRUCTURES, TILE, Tile, WEAPONS,
  buildTargetTile, dist2, inBounds, tileCenter,
  type NetPlayer, type Player, type StructureId,
} from '@gojijeon/shared';
import type { ClientWorld } from '../net/clientWorld';

export interface Ghost {
  tx: number;
  ty: number;
  ok: boolean;
  reason: string;
}

export const computeGhost = (
  world: ClientWorld,
  me: NetPlayer,
  x: number,
  y: number,
  aim: number,
  structure: StructureId,
): Ghost => {
  // buildTargetTile은 Player 전체를 받지만 실제로 읽는 것은 x/y/aim뿐이다.
  // 클라에는 NetPlayer밖에 없으므로 최소 스텁으로 같은 함수를 재사용한다.
  const stub = { x, y, aim } as Pick<Player, 'x' | 'y' | 'aim'> as Player;
  const { tx, ty } = buildTargetTile(stub);

  const def = me.weapon ? WEAPONS[me.weapon] : null;
  const sdef = STRUCTURES[structure];
  const cx = tileCenter(tx);
  const cy = tileCenter(ty);

  const fail = (reason: string): Ghost => ({ tx, ty, ok: false, reason });

  if (!def || def.buildPower <= 0) return fail('망치가 없음');
  if (!inBounds(tx, ty)) return fail('맵 밖');
  if (world.tileAt(tx, ty) !== Tile.EMPTY) return fail('빈 칸이 아님');
  if (dist2(x, y, cx, cy) > BUILDING.range ** 2) return fail('너무 멈');
  if (me.ore < sdef.cost.ore || me.shard < sdef.cost.shard) return fail('자원 부족');

  const half = TILE / 2 + PLAYER.radius;
  for (const other of world.snapshot?.players ?? []) {
    if (!other.alive) continue;
    if (Math.abs(other.x - cx) < half && Math.abs(other.y - cy) < half) return fail('누가 서 있음');
  }

  return { tx, ty, ok: true, reason: sdef.name };
};

export const drawGhost = (ctx: CanvasRenderingContext2D, ghost: Ghost, structure: StructureId): void => {
  const x = ghost.tx * TILE;
  const y = ghost.ty * TILE;
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = ghost.ok ? STRUCTURES[structure].color : '#7f1d1d';
  ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2;
  ctx.strokeStyle = ghost.ok ? '#a3e635' : '#f87171';
  ctx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
  ctx.restore();
};
