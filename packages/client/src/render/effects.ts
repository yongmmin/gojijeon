/**
 * 서버 이벤트 → 화면 효과.
 *
 * 이 파일이 아는 것은 "무슨 일이 일어났을 때 무엇을 보여 줄 것인가"뿐이다.
 * 파티클을 굴리고 그리는 일은 EffectPool이 한다.
 *
 * 화면 흔들림과 비네트만 여기 남는다 — 그 둘은 개별 파티클이 아니라
 * **내 화면 전체의 상태**라 수명이 다른 물건이다.
 */
import {
  STRUCTURES, TILES, Tile, WEAPONS, tileCenter, tileXOf, tileYOf,
  type GameEvent, type PlayerId,
} from '@gojijeon/shared';
import type { ClientWorld } from '../net/clientWorld';
import { teamColor, withAlpha } from './colors';
import { EffectPool } from './effectPool';
import { teamLabel } from './teamLabel';
import { HEALTH_VIS, HIT_VIS, VIS } from './visualConfig';

export class Effects {
  private readonly pool = new EffectPool();
  /** 피격 순간 화면 전체를 살짝 붉히는 값(0..1). 내가 맞았을 때만. */
  private hurtFlash = 0;
  private shakeAmt = 0;
  private shakeSeed = 0;

  get flash(): number {
    return this.hurtFlash;
  }

  /**
   * 화면 가장자리 붉은 비네트.
   *
   * 화면 전체를 붉히면 적과 지형까지 붉어져 오히려 안 보인다. 가장자리만 물들이면
   * "내가 맞았다"는 정보만 남고 가운데는 깨끗하다. 체력이 낮으면 상시 은은하게 맥동한다.
   */
  drawVignette(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    hpRatio: number,
    nowMs: number,
  ): void {
    const low = hpRatio < HIT_VIS.lowHpRatio
      ? (1 - hpRatio / HIT_VIS.lowHpRatio) * HIT_VIS.lowHpAlpha *
        (0.55 + 0.45 * Math.sin((nowMs / HIT_VIS.lowHpPulseMs) * Math.PI * 2))
      : 0;
    const alpha = Math.max(low, this.hurtFlash * HIT_VIS.vignetteAlpha);
    if (alpha <= 0.002) return;

    const r = Math.hypot(w, h) / 2;
    const g = ctx.createRadialGradient(w / 2, h / 2, r * 0.42, w / 2, h / 2, r);
    g.addColorStop(0, 'rgba(190,30,30,0)');
    g.addColorStop(1, `rgba(190,30,30,${alpha.toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  /** 내가 맞았을 때만 아주 짧게. 크면 조준이 불가능해진다. */
  get shake(): { x: number; y: number } {
    if (this.shakeAmt <= 0) return { x: 0, y: 0 };
    const a = this.shakeAmt ** 2 * VIS.shakeMaxPx;
    return {
      x: Math.cos(this.shakeSeed) * a,
      y: Math.sin(this.shakeSeed * 1.7) * a,
    };
  }

  clear(): void {
    this.pool.clear();
    this.hurtFlash = 0;
    this.shakeAmt = 0;
  }

  /**
   * 한 칸이 통째로 사라졌다. tileBroken이 오지 않는 봉쇄벽 해제용이다 —
   * 벽이 소리 없이 없어지면 "언제 열렸지"가 되고, 그게 이번 피드백의 원인이었다.
   */
  shatter(tile: number, color: string): void {
    const x = tileCenter(tileXOf(tile));
    const y = tileCenter(tileYOf(tile));
    this.pool.burst(x, y, color, VIS.burstCount, VIS.dustLifeMs);
    this.pool.ring(x, y, 2, 30, withAlpha(color, 0.9), 2);
  }

  ingest(events: readonly GameEvent[], world: ClientWorld): void {
    for (const ev of events) this.one(ev, world);
  }

  update(dtMs: number): void {
    this.pool.update(dtMs);
    this.hurtFlash = Math.max(0, this.hurtFlash - dtMs / VIS.flashLifeMs);
    this.shakeAmt = Math.max(0, this.shakeAmt - dtMs / VIS.shakeLifeMs);
    this.shakeSeed += dtMs * 0.09;
  }

  render(ctx: CanvasRenderingContext2D): void {
    this.pool.render(ctx);
  }

  private one(ev: GameEvent, world: ClientWorld): void {
    switch (ev.t) {
      case 'hit': {
        // 때린 쪽 → 맞은 곳 방향으로 파편을 날린다. 어디서 맞았는지가 화면에 남는다.
        const from = this.playerPos(world, ev.by);
        const dir = from ? Math.atan2(ev.y - from.y, ev.x - from.x) : null;
        const mine = ev.target === world.youId;
        this.pool.burst(ev.x, ev.y, '#dc2626', VIS.burstCount + 8, VIS.particleLifeMs, dir);
        this.pool.burst(ev.x, ev.y, '#fecaca', 4, VIS.particleLifeMs * 0.6, dir);
        this.pool.ring(ev.x, ev.y, 2, 16 + ev.dmg * 0.4, withAlpha('#fecaca', 0.9), 3);
        // 숫자는 맞은 방향으로 튀어 나간다 — 어디서 날아왔는지가 숫자에도 실린다.
        const pop = dir === null ? 0 : dir;
        this.pool.text(ev.x, ev.y - 14, String(Math.round(ev.dmg)), mine ? '#fca5a5' : '#fde68a', {
          font: HIT_VIS.damageFontBig,
          vx: Math.cos(pop) * HIT_VIS.damagePopSpeed,
          vy: Math.sin(pop) * HIT_VIS.damagePopSpeed - 40,
        });
        if (mine) {
          this.hurtFlash = 1;
          this.shakeAmt = 1;
        }
        break;
      }
      // 막힘은 피해 0이다. 피가 아니라 금속이 튀고, 숫자 대신 "막힘"이라고 쓴다.
      case 'blocked':
        this.pool.ring(ev.x, ev.y, 8, 30, '#60a5fa', 4);
        this.pool.ring(ev.x, ev.y, 4, 16, withAlpha('#ffffff', 0.8), 2);
        this.pool.burst(ev.x, ev.y, '#bfdbfe', 8, VIS.particleLifeMs * 0.7);
        this.pool.text(ev.x, ev.y - 16, '막힘', '#bfdbfe', { life: VIS.damageTextLifeMs * 0.8 });
        break;
      case 'death': {
        const pos = this.playerPos(world, ev.id);
        if (pos) {
          this.pool.burst(pos.x, pos.y, teamColor(pos.team), VIS.burstCount * 2);
          this.pool.ring(pos.x, pos.y, 4, 46, withAlpha(teamColor(pos.team), 0.8), 2);
          // 죽으면 들고 있던 것이 바닥에 떨어지고 부활은 곡괭이로 시작한다.
          // 무기가 손에서 튀어나가는 걸 보여 주면 그 규칙을 설명할 필요가 없다.
          if (ev.weapon) this.pool.toss(pos.x, pos.y, ev.weapon);
        }
        break;
      }
      case 'capture': {
        const col = teamColor(ev.team);
        this.pool.ring(ev.x, ev.y, 10, 190, withAlpha(col, 0.95), 5);
        this.pool.ring(ev.x, ev.y, 10, 110, withAlpha('#ffffff', 0.7), 2);
        this.pool.burst(ev.x, ev.y, col, VIS.burstCount * 3, VIS.dustLifeMs);
        this.pool.text(ev.x, ev.y - 30, `${teamLabel(world, ev.team)} 고지 점령!`, col, {
          life: VIS.damageTextLifeMs * 2, font: HIT_VIS.damageFontBig,
        });
        break;
      }
      case 'spawn': {
        const pos = this.playerPos(world, ev.id);
        if (pos) this.pool.ring(pos.x, pos.y, 40, 6, withAlpha(teamColor(pos.team), 0.9), 2);
        break;
      }
      case 'tileBroken': {
        const color = TILES[ev.was].color;
        this.pool.burst(tileCenter(tileXOf(ev.tile)), tileCenter(tileYOf(ev.tile)), color, VIS.burstCount + 4, VIS.dustLifeMs);
        break;
      }
      case 'build':
        this.pool.ring(
          tileCenter(tileXOf(ev.tile)), tileCenter(tileYOf(ev.tile)),
          30, 8, STRUCTURES[ev.type].color, 2,
        );
        break;
      case 'structureDown':
        this.pool.burst(tileCenter(tileXOf(ev.tile)), tileCenter(tileYOf(ev.tile)), '#9ca3af', VIS.burstCount + 6, VIS.dustLifeMs);
        break;
      case 'explosion':
        this.pool.ring(ev.x, ev.y, 6, ev.radius, '#fb923c', 4);
        this.pool.burst(ev.x, ev.y, '#fdba74', VIS.burstCount * 2, VIS.dustLifeMs);
        break;
      case 'loot': {
        // 땅에서 무기가 나오는 순간은 이 게임에서 제일 중요한 사건이다.
        // 흙먼지 위로 무기 색 링과 이름을 띄워, 파던 사람이 놓치지 않게 한다.
        const def = WEAPONS[ev.weapon];
        this.pool.ring(ev.x, ev.y, 4, 46, def.color, 3);
        this.pool.burst(ev.x, ev.y, def.color, VIS.burstCount, VIS.dustLifeMs);
        this.pool.text(ev.x, ev.y - 14, def.name, def.color, { life: VIS.damageTextLifeMs * 1.6 });
        break;
      }
      case 'bounty': {
        const pos = this.playerPos(world, ev.id);
        if (pos) {
          this.pool.text(
            pos.x, pos.y - 34, `+${ev.ore} 광석 · +${ev.shard} 조각`,
            TILES[Tile.SHARD_NODE].color, { life: VIS.damageTextLifeMs * 1.4 },
          );
        }
        break;
      }
      // 구급품은 heal이 따로 그린다 — 여기서 또 그리면 숫자가 둘 겹친다.
      case 'pickup': {
        const pos = this.playerPos(world, ev.id);
        if (pos && (ev.kind === 'ore' || ev.kind === 'shard')) {
          this.pool.text(
            pos.x, pos.y - 20, `+${ev.amount}`,
            TILES[ev.kind === 'ore' ? Tile.ORE_VEIN : Tile.SHARD_NODE].color,
            { life: VIS.damageTextLifeMs * 0.7 },
          );
        }
        break;
      }
      // 회복은 피격의 반대다. 붉은 숫자와 헷갈리지 않게 초록으로, 링은 안으로 모인다.
      case 'heal': {
        this.pool.ring(ev.x, ev.y, 34, 6, withAlpha(HEALTH_VIS.heal, 0.9), 3);
        this.pool.burst(ev.x, ev.y, HEALTH_VIS.heal, VIS.burstCount, VIS.particleLifeMs);
        this.pool.text(ev.x, ev.y - 18, `+${Math.round(ev.amount)}`, HEALTH_VIS.heal, {
          font: HIT_VIS.damageFontBig, life: VIS.damageTextLifeMs * 1.2,
        });
        break;
      }
      case 'coreHit': {
        const core = world.snapshot?.cores.find((c) => c.team === ev.team);
        if (core) this.pool.ring(tileCenter(core.tx), tileCenter(core.ty), 20, 70, teamColor(core.team), 3);
        break;
      }
      // 나머지(phase/roundEnd/matchEnd/chat)는 HUD가 다룬다.
      default:
        break;
    }
  }

  private playerPos(world: ClientWorld, id: PlayerId): { x: number; y: number; team: number } | null {
    const p = world.snapshot?.players.find((q) => q.id === id);
    return p ? { x: p.x, y: p.y, team: p.team } : null;
  }

}
