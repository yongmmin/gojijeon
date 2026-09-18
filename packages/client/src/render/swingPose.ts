/**
 * 휘두르기 모션.
 *
 * **타이밍은 전부 서버 값에서 나온다** — windupTicks/recoverTicks와 스냅샷의
 * `swing`. 클라가 제 마음대로 속도를 정하면 "맞았는데 아직 안 휘두른" 화면이
 * 나온다. 여기서 정하는 것은 모양(각도·거리)뿐이다.
 *
 * 한 번의 공격은 세 국면이다.
 *  1. 선딜 — `swing > 0`. 뒤로 젖히며 당긴다. 선딜이 긴 무기일수록 오래 젖힌다.
 *  2. 타격 — `swing`이 0이 되는 순간부터 짧게. 앞으로 터져 나가고 궤적이 남는다.
 *  3. 후딜 — 나머지 시간 동안 원래 자세로 돌아온다.
 *
 * `swing`은 판정 순간 0이 되고 후딜은 스냅샷에 없다. 그래서 "방금 때렸다"를
 * 클라가 기억해야 한다(SwingAnim).
 *
 * 순수 함수다 — DOM도 캔버스도 모른다. 그래서 노드에서 위상별 값을 찍어
 * 검증할 수 있다.
 */
import { TICK_MS, type NetPlayer, type PlayerId, type WeaponDef } from '@gojijeon/shared';
import { SWING } from './visualConfig';

export type SwingPhase = 'idle' | 'windup' | 'strike' | 'recover';

export interface SwingPose {
  readonly phase: SwingPhase;
  /** aim에 더할 상대 각(rad). 음수면 뒤로 젖힌 상태. */
  readonly angle: number;
  /** 손에서 앞으로 밀어낸 거리(px). 음수면 몸쪽으로 당김. */
  readonly reach: number;
  /** 궤적 잔상의 진하기 0..1. 0이면 안 그린다. */
  readonly trail: number;
  /** 잔상이 시작되는 상대 각(rad). angle까지 훑은 것으로 그린다. */
  readonly trailFrom: number;
  /** 무기 변형(활 시위 당김) 0..1. */
  readonly pull: number;
  /** 선딜 진행도 0..1. 부채꼴 예고의 진하기로 쓴다. */
  readonly charge: number;
}

const IDLE: SwingPose = {
  phase: 'idle', angle: 0, reach: 0, trail: 0, trailFrom: 0, pull: 0, charge: 0,
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * 부채꼴이 좁을수록 "찌르기"로 읽는다. 창은 앞뒤 직선 이동이 크고 회전이 작으며,
 * 단검은 반대다. 무기 id로 분기하지 않고 레지스트리 수치만으로 갈린다.
 */
const stabWeight = (def: WeaponDef): number =>
  clamp01(1 - def.halfArc / (Math.PI / 4)) * 0.85;

const arcSpan = (def: WeaponDef): number =>
  Math.min(SWING.arcMax, Math.max(SWING.arcMin, def.halfArc * 2.4));

/** 선딜은 길수록 크게 젖힌다 — 창의 큰 동작이 "지금 피해라"가 된다. */
const windupScale = (def: WeaponDef): number =>
  clamp01(0.55 + (def.windupTicks * TICK_MS) / 900);

/**
 * @param swing 판정까지 남은 틱. 0이면 대기.
 * @param sinceHitMs 마지막 타격으로부터 지난 시간(ms). 타격 기록이 없으면 Infinity.
 */
export const swingPose = (def: WeaponDef, swing: number, sinceHitMs: number): SwingPose => {
  if (swing > 0) return windupPose(def, clamp01(1 - swing / Math.max(1, def.windupTicks)));

  const recoverMs = Math.max(1, def.recoverTicks * TICK_MS);
  const r = sinceHitMs / recoverMs;
  if (r >= 1 || r < 0) return IDLE;
  return afterHitPose(def, r);
};

const windupPose = (def: WeaponDef, p: number): SwingPose => {
  const e = easeOut(p) * windupScale(def);
  const charge = p;
  switch (def.kind) {
    case 'ranged':
      return { phase: 'windup', angle: -0.14 * e, reach: -3 * e, trail: 0, trailFrom: 0, pull: easeOut(p), charge };
    case 'throwable':
      return { phase: 'windup', angle: -1.15 * e, reach: -4 * e, trail: 0, trailFrom: 0, pull: 0, charge };
    case 'shield':
      return { phase: 'windup', angle: 0, reach: -3 * e, trail: 0, trailFrom: 0, pull: 0, charge };
    default: {
      const back = arcSpan(def) * SWING.backRatio;
      const stab = stabWeight(def);
      return {
        phase: 'windup',
        angle: -back * e * (1 - stab * 0.6),
        reach: -def.range * SWING.thrustRatio * SWING.windupPull * e,
        trail: 0, trailFrom: 0, pull: 0, charge,
      };
    }
  }
};

const afterHitPose = (def: WeaponDef, r: number): SwingPose => {
  const striking = r < SWING.strikeRatio;
  const phase: SwingPhase = striking ? 'strike' : 'recover';
  const s = clamp01(r / SWING.strikeRatio);

  switch (def.kind) {
    // 쏜 직후 뒤로 밀렸다가 제자리로. 시위는 풀려 있으므로 pull은 0.
    case 'ranged':
      return {
        phase, angle: 0.12 * (1 - r) ** 2, reach: -SWING.bowRecoil * (1 - r) ** 2,
        trail: 0, trailFrom: 0, pull: 0, charge: 0,
      };
    // 던지는 팔이 앞으로 뻗었다가 돌아온다. 무기는 이미 손을 떠났을 수 있다.
    case 'throwable':
      return {
        // 던지기 잔상은 팔이 지나간 흔적일 뿐이다. 베기만큼 진하면 폭발처럼 보인다.
        phase, angle: 0.7 * (1 - r) ** 1.5, reach: SWING.throwPush * (1 - r) ** 1.5,
        trail: (1 - r) ** 2 * 0.22, trailFrom: -0.6, pull: 0, charge: 0,
      };
    case 'shield':
      return {
        phase, angle: 0, reach: SWING.shieldPush * (1 - r) ** 2,
        trail: 0, trailFrom: 0, pull: 0, charge: 0,
      };
    default: {
      const span = arcSpan(def);
      const back = -span * SWING.backRatio;
      const fwd = span * (1 - SWING.backRatio);
      const stab = stabWeight(def);
      const rot = 1 - stab * 0.7;
      const thrust = def.range * SWING.thrustRatio * (0.4 + 0.6 * stab);
      if (striking) {
        const k = easeOutCubic(s);
        return {
          phase, angle: lerp(back, fwd, k) * rot,
          reach: thrust * Math.sin(Math.PI * s ** 0.7),
          trail: (1 - s) ** SWING.trailFade, trailFrom: back * rot,
          pull: 0, charge: 0,
        };
      }
      // 후딜: 앞으로 나간 자세에서 천천히 원위치.
      const back01 = clamp01((r - SWING.strikeRatio) / (1 - SWING.strikeRatio));
      return {
        phase, angle: fwd * rot * (1 - easeOut(back01)), reach: 0,
        trail: 0, trailFrom: 0, pull: 0, charge: 0,
      };
    }
  }
};

/**
 * 플레이어별 "방금 때렸다" 기억.
 *
 * 스냅샷에는 후딜 정보가 없다. swing이 양수였다가 0이 되는 순간을 붙잡아
 * 시각을 적어 두는 것이 후딜 애니메이션의 유일한 근거다.
 */
export class SwingAnim {
  private readonly hitAt = new Map<PlayerId, number>();
  private readonly prevSwing = new Map<PlayerId, number>();

  /** 매 프레임 스냅샷을 훑어 타격 순간을 붙잡는다. */
  observe(players: readonly NetPlayer[], nowMs: number): void {
    const seen = new Set<PlayerId>();
    for (const p of players) {
      seen.add(p.id);
      const prev = this.prevSwing.get(p.id) ?? 0;
      if (prev > 0 && p.swing === 0) this.hitAt.set(p.id, nowMs);
      this.prevSwing.set(p.id, p.swing);
    }
    // 나간 사람의 기록까지 들고 있으면 판을 거듭할수록 샌다.
    for (const id of this.prevSwing.keys()) {
      if (!seen.has(id)) {
        this.prevSwing.delete(id);
        this.hitAt.delete(id);
      }
    }
  }

  poseOf(p: NetPlayer, def: WeaponDef, nowMs: number): SwingPose {
    const at = this.hitAt.get(p.id);
    return swingPose(def, p.swing, at === undefined ? Number.POSITIVE_INFINITY : nowMs - at);
  }

  /** 마지막 타격으로부터 지난 시간. 죽는 연출이 방향을 잡을 때 쓴다. */
  sinceHit(id: PlayerId, nowMs: number): number {
    const at = this.hitAt.get(id);
    return at === undefined ? Number.POSITIVE_INFINITY : nowMs - at;
  }

  clear(): void {
    this.hitAt.clear();
    this.prevSwing.clear();
  }
}
