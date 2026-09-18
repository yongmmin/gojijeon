/**
 * 화면을 덮는 상태 안내 — 맵 수신, 사망, 라운드·매치 종료, 관전.
 *
 * 무엇을 띄울지는 스냅샷의 phase 하나로 갈린다. 씬에서 떼어 둔 이유는
 * 이 판단이 입력·카메라·렌더와 아무 관계가 없기 때문이다.
 *
 * 관전만 오버레이가 아니라 HUD 아래 띠로 간다 — 상태가 길게 이어지는데
 * 화면을 덮어 두면 정작 볼 것을 못 본다.
 */
import { Phase, TICK_HZ } from '@gojijeon/shared';
import type { ClientWorld } from '../net/clientWorld';
import { formatClock } from './dom';
import type { Hud } from './hud';
import type { Overlay } from './overlay';
import type { RoundEndPanel, RoundResult } from './roundEndPanel';

export const updateStatusOverlay = (
  world: ClientWorld,
  overlay: Overlay,
  hud: Hud,
  result: RoundEndPanel,
  lastResult: RoundResult | null,
): void => {
  const snap = world.snapshot;
  const me = world.me;
  if (!snap) {
    overlay.show('맵을 받는 중…');
    return;
  }
  hud.setNotice(null);

  // 라운드·매치 종료는 순위표까지 붙은 전용 화면이 맡는다.
  const ending = snap.phase === Phase.MATCH_END || snap.phase === Phase.ROUND_END;
  if (ending && lastResult) {
    overlay.hide();
    result.update(world, lastResult);
    return;
  }
  result.hide();
  if (ending) {
    // 결과 이벤트를 놓친 채 합류한 경우(중간 입장). 승자를 모르므로 조용히 기다린다.
    overlay.show(snap.phase === Phase.MATCH_END ? '매치 종료' : `라운드 ${snap.round} 종료`, '', [], true);
    return;
  }
  // 관전은 상태가 길게 이어진다. 화면을 덮는 대신 아래쪽 띠로만 알린다.
  if (me && !me.alive && me.spectating) {
    hud.setNotice('관전 중 — F로 시점 전환, WASD로 이동');
    overlay.hide();
    return;
  }
  hud.setNotice(null);
  if (me && !me.alive) {
    // 들고 있던 무기는 그 자리에 떨어져 있다. 되찾으러 갈지 새로 팔지가
    // 부활을 기다리는 동안 하는 유일한 고민이므로, 그걸 상기시킨다.
    const left = me.respawnIn > 0 ? `부활까지 ${formatClock(me.respawnIn / TICK_HZ)}` : '부활 대기 중…';
    overlay.show('쓰러졌다', `${left} · 들고 있던 무기는 쓰러진 자리에 남았다`, [], true);
    return;
  }
  overlay.hide();
};
