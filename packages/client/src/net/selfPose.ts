/**
 * 내 캐릭터만 다르게 그린다.
 *
 * 보간 버퍼는 **스냅샷 두 개 사이**를 메우는 장치라, 구조적으로 스냅샷 간격
 * (20Hz = 50ms) 밑으로 내려갈 수 없다. 그래서 지연을 80ms로 잡아 두었다.
 * 남의 캐릭터에는 그게 옳다 — 부드럽고, 패킷이 하나 늦어도 끊기지 않는다.
 *
 * 하지만 **내 캐릭터까지 80ms 뒤에 그리면 내 조작이 굼떠 보인다.** 실측으로
 * 입력에서 화면까지 124ms였고, 그중 80ms가 이것이었다. 남을 보는 부드러움과
 * 내 손이 붙는 느낌은 서로 다른 요구다.
 *
 * 그래서 내 캐릭터는 보간하지 않고 **가장 최근 스냅샷 위치로 빠르게 수렴**시킨다.
 * 그냥 최신 위치를 바로 쓰면(지연 0) 20Hz로 8px씩 계단처럼 튀므로, 시간 상수
 * 하나로 부드럽게 따라가게 한다. 대략 25ms의 지연과 맞바꾸는 셈이고,
 * 총 124ms → 45ms 근처가 된다.
 *
 * 서버 예측(prediction)은 아니다. 위치는 여전히 서버가 정한다 — 화면에
 * 옮기는 방식만 바꾼 것이라, 벽을 뚫거나 서버와 어긋날 여지가 없다.
 */
import type { Pose } from './snapshotBuffer';

/**
 * 수렴 시간 상수(ms). 작을수록 즉각적이고 클수록 부드럽다.
 * 25ms면 한 스냅샷(50ms) 안에 사실상 따라잡는다.
 */
const TAU_MS = 25;

/**
 * 이보다 멀리 떨어지면 따라가지 않고 그 자리로 건너뛴다.
 * 부활·라운드 교체처럼 순간이동한 경우에 화면을 가로질러 미끄러지면 안 된다.
 */
const SNAP_DISTANCE = 64;

export class SelfPose {
  private pose: Pose | null = null;

  /** 라운드가 바뀌거나 방을 나갈 때. 다음 프레임에 새 위치로 바로 선다. */
  reset(): void {
    this.pose = null;
  }

  /**
   * `target`은 가장 최근 스냅샷의 내 위치(보간되지 않은 값).
   * `dtMs`는 지난 프레임과의 간격 — 프레임률이 달라도 같은 속도로 수렴하게 한다.
   */
  follow(target: Pose, dtMs: number): Pose {
    if (!this.pose) {
      this.pose = { ...target };
      return this.pose;
    }

    const dx = target.x - this.pose.x;
    const dy = target.y - this.pose.y;
    if (dx * dx + dy * dy > SNAP_DISTANCE * SNAP_DISTANCE) {
      this.pose = { ...target };
      return this.pose;
    }

    // 지수 수렴. dt에 무관하게 같은 시간 상수를 갖는다.
    const k = 1 - Math.exp(-Math.max(0, dtMs) / TAU_MS);
    this.pose = {
      x: this.pose.x + dx * k,
      y: this.pose.y + dy * k,
      // 조준은 내 마우스가 이미 정한 값이라 서버를 기다릴 이유가 없다.
      aim: target.aim,
    };
    return this.pose;
  }
}
