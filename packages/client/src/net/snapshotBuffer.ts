/**
 * 스냅샷 보간 버퍼.
 *
 * 서버는 20Hz, 화면은 60fps다. 그 간격을 메우는 유일한 장치가 이것이다.
 * 항상 NET.interpolationDelayMs 만큼 과거를 렌더해서 두 스냅샷 사이에 낀 상태로 둔다 —
 * 그래야 패킷이 하나 늦어도 끊겨 보이지 않는다.
 * 미래를 추정(extrapolation)하지는 않는다. 스냅샷이 끊기면 마지막 상태로 멈춘다.
 */
import { NET, angleDelta, type PlayerId, type Snapshot } from '@gojijeon/shared';
import { VIS } from '../render/visualConfig';

export interface Pose {
  x: number;
  y: number;
  aim: number;
}

export interface SampledWorld {
  players: Map<PlayerId, Pose>;
  projectiles: Map<number, Pose>;
}

interface Entry {
  s: Snapshot;
  recvAt: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number): number => a + angleDelta(b, a) * t;

const emptySample = (): SampledWorld => ({ players: new Map(), projectiles: new Map() });

export class SnapshotBuffer {
  private entries: Entry[] = [];

  push(s: Snapshot, nowMs: number): void {
    // 순서가 뒤집혀 도착한 스냅샷은 버린다. 보간 구간이 음수가 되는 것을 막는다.
    const last = this.entries[this.entries.length - 1];
    if (last && s.tick < last.s.tick) return;
    this.entries.push({ s, recvAt: nowMs });
    this.prune(nowMs);
  }

  get latest(): Snapshot | null {
    const last = this.entries[this.entries.length - 1];
    return last ? last.s : null;
  }

  clear(): void {
    this.entries = [];
  }

  sample(nowMs: number): SampledWorld {
    if (this.entries.length === 0) return emptySample();
    const target = nowMs - NET.interpolationDelayMs;

    let i = -1;
    for (let k = 0; k < this.entries.length; k++) {
      if (this.entries[k].recvAt <= target) i = k;
      else break;
    }

    // 렌더 시점이 버퍼보다 과거거나 미래면 가장 가까운 스냅샷을 그대로 쓴다.
    if (i < 0) return poseOf(this.entries[0].s);
    if (i >= this.entries.length - 1) return poseOf(this.entries[this.entries.length - 1].s);

    const a = this.entries[i];
    const b = this.entries[i + 1];
    const span = b.recvAt - a.recvAt;
    const t = span > 0 ? Math.min(1, Math.max(0, (target - a.recvAt) / span)) : 1;
    return blend(a.s, b.s, t);
  }

  private prune(nowMs: number): void {
    const cutoff = nowMs - VIS.snapshotHistoryMs;
    // 보간에는 언제나 두 개가 필요하므로 마지막 둘은 나이와 무관하게 남긴다.
    while (this.entries.length > 2 && this.entries[0].recvAt < cutoff) this.entries.shift();
  }
}

const poseOf = (s: Snapshot): SampledWorld => {
  const out = emptySample();
  for (const p of s.players) out.players.set(p.id, { x: p.x, y: p.y, aim: p.aim });
  for (const pr of s.projectiles) out.projectiles.set(pr.id, { x: pr.x, y: pr.y, aim: Math.atan2(pr.vy, pr.vx) });
  return out;
};

/** id로 짝을 맞춘다. 이전 스냅샷에 없던 엔티티는 보간 없이 최신 위치로 바로 나타난다. */
const blend = (a: Snapshot, b: Snapshot, t: number): SampledWorld => {
  const out = emptySample();

  const prevPlayers = new Map<PlayerId, Pose>();
  for (const p of a.players) prevPlayers.set(p.id, { x: p.x, y: p.y, aim: p.aim });
  for (const p of b.players) {
    const prev = prevPlayers.get(p.id);
    out.players.set(
      p.id,
      prev
        ? { x: lerp(prev.x, p.x, t), y: lerp(prev.y, p.y, t), aim: lerpAngle(prev.aim, p.aim, t) }
        : { x: p.x, y: p.y, aim: p.aim },
    );
  }

  const prevProj = new Map<number, Pose>();
  for (const pr of a.projectiles) prevProj.set(pr.id, { x: pr.x, y: pr.y, aim: Math.atan2(pr.vy, pr.vx) });
  for (const pr of b.projectiles) {
    const prev = prevProj.get(pr.id);
    const aim = Math.atan2(pr.vy, pr.vx);
    out.projectiles.set(
      pr.id,
      prev ? { x: lerp(prev.x, pr.x, t), y: lerp(prev.y, pr.y, t), aim } : { x: pr.x, y: pr.y, aim },
    );
  }

  return out;
};
