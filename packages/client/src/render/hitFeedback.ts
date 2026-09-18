/**
 * "맞았다"를 몸에 남기는 상태.
 *
 * 곡괭이 한 대는 체력의 8%다. 체력바가 2픽셀 줄어드는 것만으로는 때린 사람도
 * 맞은 사람도 알아채지 못한다 — 실제로 플레이테스트에서 "때리는 게 없냐"는
 * 말이 나왔다. 그래서 맞은 몸을 번쩍이고, 깎여 나간 체력을 잔상으로 남긴다.
 *
 * 이벤트는 순간이고 그림은 지속이므로 누군가는 시각을 기억해야 한다. 그게 여기다.
 * 게임 판정과는 무관하다 — 전부 사라져도 규칙은 그대로다.
 */
import { PLAYER, type GameEvent, type NetPlayer, type PlayerId } from '@gojijeon/shared';
import { HIT_VIS } from './visualConfig';

interface Mark {
  /** 마지막으로 맞은 시각. */
  at: number;
  /** 맞기 직전의 체력 비율. 잔상이 여기서부터 따라 내려온다. */
  fromRatio: number;
  /** 막힌 것인가. 막힘은 피가 아니라 금속음이므로 색이 달라야 한다. */
  blocked: boolean;
}

export interface HitLook {
  /** 몸 전체를 덮는 번쩍임 0..1. */
  flash: number;
  /** 잔상이 시작되는 체력 비율. 없으면 현재 비율과 같다. */
  ghostRatio: number;
  /** 체력바를 굵게 하는 정도 0..1. */
  emphasis: number;
  blocked: boolean;
}

const NONE: HitLook = { flash: 0, ghostRatio: 0, emphasis: 0, blocked: false };

export class HitFeedback {
  private readonly marks = new Map<PlayerId, Mark>();
  /** 직전 프레임의 체력 비율. 잔상의 출발점을 여기서 집는다. */
  private readonly lastRatio = new Map<PlayerId, number>();

  ingest(events: readonly GameEvent[], nowMs: number): void {
    for (const ev of events) {
      if (ev.t !== 'hit' && ev.t !== 'blocked') continue;
      const id = ev.target;
      this.marks.set(id, {
        at: nowMs,
        fromRatio: this.lastRatio.get(id) ?? 1,
        blocked: ev.t === 'blocked',
      });
    }
  }

  /** 매 프레임 스냅샷을 훑어 다음 피격의 출발점을 갱신하고 떠난 사람을 지운다. */
  observe(players: readonly NetPlayer[], nowMs: number): void {
    const seen = new Set<PlayerId>();
    for (const p of players) {
      seen.add(p.id);
      const ratio = Math.max(0, Math.min(1, p.hp / PLAYER.maxHp));
      const mark = this.marks.get(p.id);
      // 잔상이 살아 있는 동안에는 출발점을 덮어쓰면 안 된다 — 깎인 구간이 사라진다.
      if (!mark || nowMs - mark.at >= HIT_VIS.hpGhostMs) this.lastRatio.set(p.id, ratio);
    }
    for (const id of this.lastRatio.keys()) {
      if (seen.has(id)) continue;
      this.lastRatio.delete(id);
      this.marks.delete(id);
    }
  }

  look(p: NetPlayer, nowMs: number): HitLook {
    const mark = this.marks.get(p.id);
    if (!mark) return NONE;
    const age = nowMs - mark.at;
    if (age >= HIT_VIS.hpGhostMs) return NONE;

    const ratio = Math.max(0, Math.min(1, p.hp / PLAYER.maxHp));
    const ghost = 1 - age / HIT_VIS.hpGhostMs;
    return {
      flash: age < HIT_VIS.bodyFlashMs ? 1 - age / HIT_VIS.bodyFlashMs : 0,
      // 잔상은 남은 체력에서 출발점까지를 시간에 따라 좁혀 간다.
      ghostRatio: ratio + Math.max(0, mark.fromRatio - ratio) * ghost,
      emphasis: ghost,
      blocked: mark.blocked,
    };
  }

  clear(): void {
    this.marks.clear();
    this.lastRatio.clear();
  }
}
