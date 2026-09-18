/**
 * 날아다니는 것들.
 *
 * 그림은 `NetProjectile.weapon`이 가리키는 무기의 **kind**로 고른다 — 무기 id로
 * 분기하지 않으므로 shared에 새 투사체 무기를 넣어도 이 파일은 그대로다.
 * `weapon`이 null이면 무기에서 나온 것이 아니다(포탑 탄). 화살과 확실히 다르게
 * 그려야 "누가 쏜 것인지"가 맞기 전에 읽힌다.
 */
import { weaponDef, type WeaponId } from '@gojijeon/shared';
import { MATERIAL as M } from './visualConfig';
import { shade, withAlpha } from './colors';
import type { Pose } from '../net/snapshotBuffer';

export const drawProjectile = (
  ctx: CanvasRenderingContext2D,
  pose: Pose,
  r: number,
  weapon: WeaponId | null,
  color: string,
  nowMs: number,
): void => {
  if (weapon === null) {
    drawBolt(ctx, pose, r, color, nowMs);
    return;
  }
  if (weaponDef(weapon).kind === 'throwable') {
    drawLobbed(ctx, pose, r, weapon, color, nowMs);
    return;
  }
  drawArrow(ctx, pose, r, color);
};

/** 활에서 나온 것. 진행 방향으로 늘어난 몸체 + 짧은 잔상이 속도를 보여준다. */
const drawArrow = (ctx: CanvasRenderingContext2D, pose: Pose, r: number, color: string): void => {
  const len = Math.max(12, r * 4.5);
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.aim);

  ctx.strokeStyle = withAlpha(color, 0.3);
  ctx.lineWidth = Math.max(2, r);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-len * 2.2, 0);
  ctx.lineTo(-len * 0.6, 0);
  ctx.stroke();

  ctx.strokeStyle = M.outline;
  ctx.lineWidth = Math.max(3, r + 1.5);
  ctx.beginPath();
  ctx.moveTo(-len * 0.7, 0);
  ctx.lineTo(len * 0.5, 0);
  ctx.stroke();

  ctx.strokeStyle = M.wood;
  ctx.lineWidth = Math.max(1.6, r - 1.4);
  ctx.beginPath();
  ctx.moveTo(-len * 0.7, 0);
  ctx.lineTo(len * 0.3, 0);
  ctx.stroke();

  // 촉은 팀색으로 — 누가 쏜 화살인지가 맞기 전에 읽혀야 한다.
  ctx.fillStyle = color;
  ctx.strokeStyle = M.outline;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(len * 0.95, 0);
  ctx.lineTo(len * 0.2, -r * 0.95);
  ctx.lineTo(len * 0.2, r * 0.95);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = M.string;
  ctx.beginPath();
  ctx.moveTo(-len * 0.7, 0);
  ctx.lineTo(-len * 0.35, -r * 0.8);
  ctx.lineTo(-len * 0.35, r * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

/**
 * 포탑 탄. 사람이 쏜 것이 아니므로 화살과 실루엣부터 다르게 —
 * 꼬리 없는 작고 둥근 탄이 흰 코어를 품고 번진다.
 */
const drawBolt = (
  ctx: CanvasRenderingContext2D,
  pose: Pose,
  r: number,
  color: string,
  nowMs: number,
): void => {
  const pulse = 0.75 + 0.25 * Math.sin(nowMs / 70);
  const core = Math.max(2.5, r);

  ctx.save();
  ctx.fillStyle = withAlpha(color, 0.22);
  ctx.beginPath();
  ctx.arc(pose.x, pose.y, core * 3 * pulse, 0, Math.PI * 2);
  ctx.fill();

  // 짧은 잔상. 화살처럼 길게 끌면 다시 헷갈린다.
  ctx.strokeStyle = withAlpha(color, 0.45);
  ctx.lineWidth = core * 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pose.x - Math.cos(pose.aim) * core * 3.5, pose.y - Math.sin(pose.aim) * core * 3.5);
  ctx.lineTo(pose.x, pose.y);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.strokeStyle = M.outline;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(pose.x, pose.y, core * 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(pose.x, pose.y, core * 0.65 * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

/** 던져진 몸통. 회전과 심지 불꽃이 "곧 터진다"를 말해 준다. */
const drawLobbed = (
  ctx: CanvasRenderingContext2D,
  pose: Pose,
  r: number,
  weapon: WeaponId,
  color: string,
  nowMs: number,
): void => {
  // 몸통은 무기 고유색, 팀색은 바닥 그림자로만 — 폭탄은 누가 던졌든 똑같이 위험하다.
  const body = weaponDef(weapon).color;
  const spin = (nowMs / 140) % (Math.PI * 2);

  ctx.save();
  ctx.fillStyle = withAlpha(color, 0.25);
  ctx.beginPath();
  ctx.arc(pose.x, pose.y, r * 2.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.translate(pose.x, pose.y);
  ctx.rotate(spin);
  ctx.fillStyle = body;
  ctx.strokeStyle = M.outline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = shade(body, 1.5);
  ctx.beginPath();
  ctx.arc(-r * 0.5, -r * 0.5, r * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 불꽃은 회전과 무관하게 깜빡여야 타이머처럼 보인다.
  const flare = 0.6 + 0.4 * Math.sin(nowMs / 60);
  ctx.fillStyle = withAlpha(M.spark, flare);
  ctx.beginPath();
  ctx.arc(pose.x, pose.y - r * 1.9, r * 0.7 * flare + 1, 0, Math.PI * 2);
  ctx.fill();
};
