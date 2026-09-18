/** 플레이어 이동. 축을 분리해 밀어내므로 벽을 따라 미끄러진다. */
import { DT, PLAYER } from '../config/balance.js';
import { weaponDef } from '../weapons.js';
import type { Player, World } from '../types.js';
import { circleFits } from './world.js';

/** 휘두르는 중에는 느려진다. 선딜이 긴 무기일수록 이 페널티가 아프다. */
const WINDUP_SLOW = 0.45;

export const playerSpeed = (w: World, p: Player): number => {
  const def = p.weapon ? weaponDef(p.weapon) : null;
  let s = PLAYER.baseSpeed * (def?.speedMultiplier ?? 1.05); // 맨손은 아주 조금 빠르다
  if (p.swingHitTick > w.tick) s *= WINDUP_SLOW;
  return s;
};

export const applyMovement = (w: World, p: Player): void => {
  const { mx, my } = p.input;
  let dx = mx, dy = my;
  const len = Math.hypot(dx, dy);
  if (len > 1) { dx /= len; dy /= len; }

  const speed = playerSpeed(w, p);
  const stepX = dx * speed * DT;
  const stepY = dy * speed * DT;
  const r = PLAYER.radius;

  if (stepX !== 0 && circleFits(w, p.x + stepX, p.y, r, p.team)) p.x += stepX;
  if (stepY !== 0 && circleFits(w, p.x, p.y + stepY, r, p.team)) p.y += stepY;

  p.vx = dx * speed;
  p.vy = dy * speed;
  p.aim = p.input.aim;
};

/**
 * 넉백처럼 외부에서 밀 때. 벽을 뚫지 않도록 잘게 나눠 밀어본다.
 * 실패하면 그 자리에 멈춘다 — 벽에 몰린 쪽이 불리한 건 의도된 것이다.
 */
export const shove = (w: World, p: Player, dx: number, dy: number): void => {
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    const nx = p.x + dx / steps;
    const ny = p.y + dy / steps;
    if (circleFits(w, nx, p.y, PLAYER.radius, p.team)) p.x = nx;
    if (circleFits(w, p.x, ny, PLAYER.radius, p.team)) p.y = ny;
  }
};
