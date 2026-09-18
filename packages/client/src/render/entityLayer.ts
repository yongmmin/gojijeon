/**
 * 움직이는 것들. 지형 위, 이펙트 아래.
 *
 * 그리는 순서: 드롭 → 건축물 → 코어 → 투사체 → 플레이어.
 * 색과 크기는 전부 shared 레지스트리에서 읽는다.
 */
import {
  ModeId, PLAYER, TILE, WEAPONS, tileCenter, tileXOf, tileYOf, type NetPlayer,
} from '@gojijeon/shared';
import type { ClientWorld } from '../net/clientWorld';
import type { Pose, SampledWorld } from '../net/snapshotBuffer';
import { drawAvatarPattern, drawSelfMarker, drawSelfRing } from './avatar';
import type { Camera } from './camera';
import { shade, teamColor, withAlpha } from './colors';
import { hpBar } from './hpBar';
import { drawDrop } from './dropArt';
import type { HitFeedback, HitLook } from './hitFeedback';
import { drawNameTag } from './nameTag';
import { drawOutpost } from './outpostLayer';
import { drawCore, drawStructure } from './structureLayer';
import { drawProjectile } from './projectileArt';
import type { SwingAnim } from './swingPose';
import { VIS } from './visualConfig';
import { drawBareHand, drawHeldWeapon } from './weaponGlyph';

/** 프레임마다 달라지지만 월드 상태는 아닌 것들. 인자 목록이 길어지는 것을 막는다. */
export interface EntityFrame {
  nowMs: number;
  anim: SwingAnim;
  hits: HitFeedback;
}

/** 플레이어 하나를 어떻게 보여 줄지. 방 설정에 따라 달라지는 것만 모았다. */
interface PlayerStyle {
  isMe: boolean;
  /** 팀전에서는 이름도 팀색으로 칠한다. 개인전은 전부 고유 팀이라 의미가 없다. */
  teamMode: boolean;
  /** 싱글의 봇처럼 존재감을 낮출 대상. */
  dim: boolean;
  nowMs: number;
}

export const drawEntities = (
  ctx: CanvasRenderingContext2D,
  world: ClientWorld,
  sample: SampledWorld,
  cam: Camera,
  frame: EntityFrame,
): void => {
  const snap = world.snapshot;
  if (!snap) return;
  const { nowMs, anim, hits } = frame;
  const teamMode = world.mode === ModeId.TEAM;
  const single = world.isSingle;

  if (snap.outpost) drawOutpost(ctx, snap.outpost, nowMs);
  for (const d of snap.drops) drawDrop(ctx, d, nowMs);
  for (const st of world.structures.values()) drawStructure(ctx, st);
  for (const c of snap.cores) drawCore(ctx, c);

  for (const pr of snap.projectiles) {
    const pose = sample.projectiles.get(pr.id) ?? { x: pr.x, y: pr.y, aim: Math.atan2(pr.vy, pr.vx) };
    drawProjectile(ctx, pose, pr.r, pr.weapon, teamColor(pr.team), nowMs);
  }

  anim.observe(snap.players, nowMs);
  hits.observe(snap.players, nowMs);
  for (const p of snap.players) {
    if (!p.alive) continue;
    const pose = sample.players.get(p.id) ?? { x: p.x, y: p.y, aim: p.aim };
    // 싱글에서 봇 이름까지 또렷하면 정작 내 이름이 묻힌다. 봇은 한 단계 내린다.
    drawPlayer(ctx, p, pose, cam, anim, hits.look(p, nowMs), {
      isMe: p.id === world.youId,
      teamMode,
      dim: single && p.bot,
      nowMs,
    });
  }
};

const drawPlayer = (
  ctx: CanvasRenderingContext2D,
  p: NetPlayer,
  pose: Pose,
  cam: Camera,
  anim: SwingAnim,
  hit: HitLook,
  style: PlayerStyle,
): void => {
  // 화면 밖은 이름표·HP바 비용이 아까우므로 통째로 건너뛴다.
  const pad = TILE * 2;
  if (
    pose.x < cam.left - pad || pose.x > cam.left + cam.viewW + pad ||
    pose.y < cam.top - pad || pose.y > cam.top + cam.viewH + pad
  ) return;

  const col = teamColor(p.team);

  if (p.mining >= 0) drawMiningLink(ctx, pose, p.mining);

  ctx.fillStyle = p.connected ? withAlpha(col, 0.28) : withAlpha(col, 0.12);
  ctx.beginPath();
  ctx.arc(pose.x, pose.y, PLAYER.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = style.isMe ? 3 : 2;
  ctx.stroke();

  // 팀색만으로는 같은 팀 네 명이 구분되지 않는다. 몸통 안에 고유 무늬를 하나 더 얹는다.
  drawAvatarPattern(ctx, pose.x, pose.y, col, p.id);
  if (style.isMe) drawSelfRing(ctx, pose.x, pose.y);

  const weapon = p.weapon ? WEAPONS[p.weapon] : null;
  const held = { x: pose.x, y: pose.y, aim: pose.aim };
  if (weapon) drawHeldWeapon(ctx, held, weapon, anim.poseOf(p, weapon, style.nowMs));
  else drawBareHand(ctx, held);

  // 맞은 몸을 통째로 덮어 번쩍인다. 이게 "한 대 들어갔다"를 말하는 가장 짧은 문장이다.
  if (hit.flash > 0) drawBodyFlash(ctx, pose, hit);

  // 적 체력바는 만난 순간부터 보여야 싸울지 도망갈지 정할 수 있다 — 항상 그린다.
  hpBar(ctx, pose.x, pose.y - PLAYER.radius - 9, VIS.hpBarWidth, p.hp / PLAYER.maxHp, hit);
  drawPlayerName(ctx, p, pose, style);
  if (style.isMe) drawSelfMarker(ctx, pose.x, pose.y, style.nowMs);
};

/** 막힌 것은 피가 아니라 금속이다. 흰 번쩍임 대신 파란 테두리만 울린다. */
const drawBodyFlash = (ctx: CanvasRenderingContext2D, pose: Pose, hit: HitLook): void => {
  ctx.save();
  if (hit.blocked) {
    ctx.strokeStyle = withAlpha('#93c5fd', hit.flash);
    ctx.lineWidth = 3 + hit.flash * 3;
    ctx.beginPath();
    ctx.arc(pose.x, pose.y, PLAYER.radius + 3, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.fillStyle = withAlpha('#ffffff', 0.55 + 0.4 * hit.flash);
    ctx.beginPath();
    ctx.arc(pose.x, pose.y, PLAYER.radius + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = withAlpha('#ef4444', hit.flash);
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.restore();
};

const drawPlayerName = (
  ctx: CanvasRenderingContext2D,
  p: NetPlayer,
  pose: Pose,
  style: PlayerStyle,
): void => {
  const label = style.isMe ? `나 (${p.name})` : p.name;
  drawNameTag(ctx, pose.x, pose.y - PLAYER.radius - VIS.nameTag.gap, label, {
    color: style.isMe ? '#ffffff' : style.teamMode ? shade(teamColor(p.team), 1.35) : '#e5e7eb',
    alpha: style.dim ? VIS.nameTag.botAlpha : 1,
    emphasis: style.isMe,
  });
};

/** 무엇을 파고 있는지 보이면 "저기 뚫린다"를 남들이 읽을 수 있다. */
const drawMiningLink = (ctx: CanvasRenderingContext2D, pose: Pose, tile: number): void => {
  const tx = tileXOf(tile);
  const ty = tileYOf(tile);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(pose.x, pose.y);
  ctx.lineTo(tileCenter(tx), tileCenter(ty));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeRect(tx * TILE + 1, ty * TILE + 1, TILE - 2, TILE - 2);
};
