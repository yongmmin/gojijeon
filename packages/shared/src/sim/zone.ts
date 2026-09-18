/**
 * 붕괴 구역.
 *
 * 전투가 길어지면 넓은 맵에서 서로를 못 찾고 각자 땅만 파다 끝난다.
 * 그래서 시간이 갈수록 설 수 있는 땅을 좁혀, 어디에 있든 결국 고지 근처로
 * 몰리게 한다.
 *
 * **가두지 않고 아프게 한다.** 벽으로 막는 편이 직관적이지만, 이 게임은 땅을
 * 파는 것이 이동이라 굴 안에 갇히는 사고가 흔할 수밖에 없다. 밖에 있으면
 * 피가 닳게 두면 갇히는 일 없이 같은 압력을 줄 수 있다.
 */
import { MAP_TILES, TICK_HZ, TILE, ZONE } from '../config/balance.js';
import { dist2 } from '../math.js';
import { Phase, type World } from '../types.js';
import { damagePlayer } from './damage.js';

const CENTER_PX = (MAP_TILES * TILE) / 2;

export const zoneCenter = (): { x: number; y: number } => ({ x: CENTER_PX, y: CENTER_PX });

/**
 * 지금 시점의 구역 반경(px).
 *
 * 전투 페이즈의 진행도로만 결정된다 — 시계 하나만 보면 되므로 서버와 클라가
 * 따로 계산해도 절대 어긋나지 않는다.
 */
export const zoneRadius = (w: World): number => {
  const start = ZONE.startTiles * TILE;
  if (w.phase !== Phase.COMBAT) return start;

  const total = w.combatTicks;
  if (total <= 0) return start;

  const elapsed = total - Math.max(0, w.phaseEndTick - w.tick);
  const t = elapsed / total;

  if (t <= ZONE.shrinkStartRatio) return start;
  if (t >= ZONE.shrinkEndRatio) return ZONE.endTiles * TILE;

  const span = ZONE.shrinkEndRatio - ZONE.shrinkStartRatio;
  const k = (t - ZONE.shrinkStartRatio) / span;
  return start + (ZONE.endTiles * TILE - start) * k;
};

/**
 * 지금 좁아지는 중인가.
 *
 * 상태를 들고 있지 않고 시계만 보고 답한다 — 서버가 재시작하거나 클라가
 * 중간에 들어와도 같은 답이 나온다.
 */
export const isZoneShrinking = (w: World): boolean => {
  if (w.phase !== Phase.COMBAT || w.combatTicks <= 0) return false;
  const elapsed = w.combatTicks - Math.max(0, w.phaseEndTick - w.tick);
  const t = elapsed / w.combatTicks;
  return t > ZONE.shrinkStartRatio && t < ZONE.shrinkEndRatio;
};

export const isOutsideZone = (w: World, x: number, y: number): boolean => {
  const r = zoneRadius(w);
  return dist2(x, y, CENTER_PX, CENTER_PX) > r * r;
};

/**
 * 어떤 지점을 구역 안으로 끌어온다.
 *
 * 부활 자리가 구역 밖일 때 쓴다. 방향은 유지한 채 중심 쪽으로만 당기므로,
 * 기지가 좁혀 나가도 "내 쪽에서 나온다"는 감각은 남는다.
 */
export const clampIntoZone = (
  w: World, x: number, y: number, margin = TILE * 2,
): { x: number; y: number } => {
  const r = Math.max(TILE, zoneRadius(w) - margin);
  const dx = x - CENTER_PX;
  const dy = y - CENTER_PX;
  const d = Math.hypot(dx, dy);
  if (d <= r || d === 0) return { x, y };
  return { x: CENTER_PX + (dx / d) * r, y: CENTER_PX + (dy / d) * r };
};

/**
 * 구역 밖에 있는 사람을 깎는다.
 *
 * 초당 한 번만 처리한다. 매 틱 깎으면 피격 이벤트가 20Hz로 쏟아져
 * 화면이 비명을 지르고, 무엇에 맞고 있는지도 알 수 없게 된다.
 */
export const updateZone = (w: World): void => {
  if (w.phase !== Phase.COMBAT) return;
  if (w.tick % TICK_HZ !== 0) return;

  for (const p of w.players.values()) {
    if (!p.alive || !isOutsideZone(w, p.x, p.y)) continue;
    // 자기 자신이 가해자다. 킬 보상이 누구에게도 가지 않고, 넉백도 없다.
    damagePlayer(w, p, ZONE.damagePerSecond, p.id, p.x, p.y, 0);
  }
};
