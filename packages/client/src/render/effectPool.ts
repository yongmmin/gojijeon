/**
 * 순간 효과의 알맹이 — 파티클·링·글자·튕겨 나간 무기.
 *
 * 무엇 때문에 생겼는지는 모른다. 수명이 지나면 스스로 사라지고, 게임 판정과는
 * 무관하다 — 전부 사라져도 규칙은 그대로다. "어떤 이벤트가 무엇을 만드는가"는
 * effects.ts가 알고, 여기는 만들어진 것을 굴리고 그리기만 한다.
 */
import type { WeaponId } from '@gojijeon/shared';
import { VIS } from './visualConfig';
import { drawWeaponSprite } from './weaponSprites';

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string }
interface Ring { x: number; y: number; from: number; to: number; life: number; max: number; color: string; width: number }
/** 떠오르는 글자. 피격 방향으로 튀어 나가야 어디서 맞았는지가 같이 읽힌다. */
interface FloatText {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; color: string; text: string; font: string;
}
/** 죽으면서 손에서 튀어나가는 무기. 드롭으로 바뀌는 규칙을 설명 없이 보여준다. */
interface Toss { x: number; y: number; vx: number; vy: number; spin: number; spinV: number; life: number; max: number; weapon: WeaponId }

export interface TextOpts {
  font?: string;
  life?: number;
  vx?: number;
  vy?: number;
}

/** 무기가 튀어나가는 연출 길이(ms). 서버가 만든 드롭이 이미 그 자리에 있으므로 짧게. */
const TOSS_LIFE_MS = 520;

export class EffectPool {
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private texts: FloatText[] = [];
  private tosses: Toss[] = [];

  clear(): void {
    this.particles = [];
    this.rings = [];
    this.texts = [];
    this.tosses = [];
  }

  /** `dir`이 있으면 그 방향으로 몰아서 튄다 — 맞은 방향을 읽히게 하는 것이 목적이다. */
  burst(
    x: number, y: number, color: string, count: number,
    life: number = VIS.particleLifeMs, dir: number | null = null,
  ): void {
    for (let i = 0; i < count; i++) {
      const a = dir === null ? Math.random() * Math.PI * 2 : dir + (Math.random() - 0.5) * 1.5;
      const sp = VIS.burstSpeed * (0.4 + Math.random() * 0.8) * (dir === null ? 1 : 1.6);
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life, max: life, size: 2 + Math.random() * 2, color,
      });
    }
  }

  ring(x: number, y: number, from: number, to: number, color: string, width: number): void {
    this.rings.push({ x, y, from, to, life: VIS.ringLifeMs, max: VIS.ringLifeMs, color, width });
  }

  text(x: number, y: number, text: string, color: string, opts: TextOpts = {}): void {
    const life = opts.life ?? VIS.damageTextLifeMs;
    this.texts.push({
      x, y, vx: opts.vx ?? 0, vy: opts.vy ?? 0,
      life, max: life, color, text, font: opts.font ?? VIS.damageFont,
    });
  }

  toss(x: number, y: number, weapon: WeaponId): void {
    const a = Math.random() * Math.PI * 2;
    this.tosses.push({
      x, y,
      vx: Math.cos(a) * 130, vy: Math.sin(a) * 130,
      spin: a, spinV: (Math.random() < 0.5 ? -1 : 1) * 9,
      life: TOSS_LIFE_MS, max: TOSS_LIFE_MS, weapon,
    });
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000;
    this.particles = this.particles.filter((p) => {
      p.life -= dtMs;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      return p.life > 0;
    });
    this.rings = this.rings.filter((r) => (r.life -= dtMs) > 0);
    this.texts = this.texts.filter((t) => {
      t.life -= dtMs;
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      // 위로는 계속 떠오르되 옆으로 튄 기세는 빠르게 죽는다.
      t.vx *= 0.9;
      t.vy = t.vy * 0.9 - dt * 26;
      return t.life > 0;
    });
    this.tosses = this.tosses.filter((t) => {
      t.life -= dtMs;
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      t.vx *= 0.9;
      t.vy *= 0.9;
      t.spin += t.spinV * dt;
      return t.life > 0;
    });
  }

  render(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    for (const r of this.rings) {
      const t = 1 - r.life / r.max;
      ctx.globalAlpha = Math.max(0, r.life / r.max);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.from + (r.to - r.from) * t, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const t of this.tosses) {
      drawWeaponSprite(ctx, t.weapon, t.x, t.y, t.spin, { alpha: Math.max(0, t.life / t.max) });
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      ctx.globalAlpha = Math.max(0, t.life / t.max);
      ctx.font = t.font;
      ctx.fillStyle = t.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineWidth = 4;
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }
}
