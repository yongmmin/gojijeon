/**
 * 고지 점령.
 *
 * 게임 이름이 여기서 나온다. 맵 한가운데 상징물이 하나 있고, 자기 팀만
 * 그 둘레에 서 있으면 시계가 돌아 10초 만에 내 것이 된다. 점령하면 옆 칸에
 * 포탑이 공짜로 선다.
 *
 * 규칙을 한 문장으로 말할 수 있게 만든 것이 설계의 전부다 — **"혼자 10초."**
 * 남이 이미 점령해 둔 곳이어도 10초고, 중립이어도 10초다. 점령 진행도를
 * 되감았다 다시 채우게 하면 "두 배로 걸리는 경우"가 생겨 설명이 길어진다.
 */
import { OUTPOST, TICK_HZ } from '../config/balance.js';
import { STRUCTURES, StructureId } from '../buildings.js';
import { dist2, tileCenter, tileIndex } from '../math.js';
import { Tile } from '../tiles.js';
import { Phase, type TeamId, type World } from '../types.js';
import { setTile } from './world.js';

/** 지금 고지에 서 있는 팀들. */
const teamsOnPoint = (w: World): TeamId[] => {
  const o = w.outpost;
  const cx = tileCenter(o.tx);
  const cy = tileCenter(o.ty);
  const r2 = OUTPOST.radius ** 2;
  const teams = new Set<TeamId>();
  for (const p of w.players.values()) {
    if (!p.alive) continue;
    if (dist2(p.x, p.y, cx, cy) <= r2) teams.add(p.team);
  }
  return [...teams];
};

/**
 * 점령 포탑을 갈아 끼운다.
 *
 * 자리는 맵 생성 때 정해 두었다. 주인이 바뀔 때마다 같은 칸에서 교체하면
 * 되므로 "빈 칸 찾기"가 필요 없고, 두 팀의 포탑이 고지 주변에 쌓이지 않는다.
 */
const placeOutpostTurret = (w: World, team: TeamId): void => {
  const { turretTx, turretTy } = w.outpost;
  const idx = tileIndex(turretTx, turretTy);

  if (w.structures.has(idx)) {
    w.structures.delete(idx);
    w.events.push({ t: 'structureDown', tile: idx });
  }

  const def = STRUCTURES[StructureId.TURRET];
  setTile(w, turretTx, turretTy, Tile.STRUCTURE);
  w.tileHp[idx] = def.hp;
  w.structures.set(idx, {
    tile: idx,
    type: StructureId.TURRET,
    team,
    // 주인 없는 구조물. 부서져도 누구에게도 자원이 환급되지 않는다.
    owner: -1,
    hp: def.hp,
    maxHp: def.hp,
    nextActTick: w.tick + def.intervalTicks,
  });
  w.events.push({ t: 'build', tile: idx, type: StructureId.TURRET, team });
};

const capture = (w: World, team: TeamId): void => {
  const o = w.outpost;
  o.owner = team;
  o.progress = 1;
  o.capturing = team;
  w.events.push({ t: 'capture', team, x: tileCenter(o.tx), y: tileCenter(o.ty) });
  placeOutpostTurret(w, team);
};

export const updateOutpost = (w: World): void => {
  // 준비 페이즈에는 봉쇄벽이 중앙을 막고 있어 물리적으로 닿을 수 없지만,
  // 규칙으로도 못 박아 둔다. 준비 시간에 승패가 갈리면 안 된다.
  if (w.phase !== Phase.COMBAT) return;

  const o = w.outpost;
  const teams = teamsOnPoint(w);
  o.contested = teams.length > 1;

  /**
   * 누적 보유 시간은 **실효 지배**를 센다. 깃발이 누구 것이냐가 아니라
   * 지금 그 자리를 혼자 쓰고 있느냐다.
   *
   * 처음에는 소유자만 쌓게 했는데, 개인전에서 판이 통째로 멈췄다 — 여섯 명이
   * 전부 남남이라 아무도 혼자가 되지 못하고, 실측으로 297초 중 292초가 경합이었다.
   * 소유권이 한 번도 안 넘어가니 시간도 한 번도 안 쌓였다. 혼자 선 순간순간을
   * 인정해 주면, 점령을 끝내지 못해도 판이 결론에 도달한다.
   */
  if (o.contested) {
    // 아무도 실효 지배하지 못한다. 주인이어도 못 쌓는다.
  } else if (teams.length === 1) {
    w.holdTicks[teams[0]] = (w.holdTicks[teams[0]] ?? 0) + 1;
  } else if (o.owner !== null) {
    // 비어 있어도 깃발은 그대로다.
    w.holdTicks[o.owner] = (w.holdTicks[o.owner] ?? 0) + 1;
  }

  if (o.contested) return;

  if (teams.length === 0) {
    // 아무도 없으면 진행도가 천천히 되돌아간다. 잠깐 들렀다 간 사람의
    // 진행도가 라운드 내내 남아 있으면 마지막 1초 날치기가 가능해진다.
    o.progress = Math.max(0, o.progress - OUTPOST.decayPerTick);
    if (o.progress === 0 && o.owner === null) o.capturing = null;
    return;
  }

  const team = teams[0];
  if (o.owner === team) {
    o.progress = 1;
    o.capturing = team;
    return;
  }

  if (o.capturing !== team) {
    o.capturing = team;
    o.progress = 0;
  }
  o.progress = Math.min(1, o.progress + 1 / OUTPOST.captureTicks);
  if (o.progress >= 1) capture(w, team);
};

/** 라운드가 새로 시작될 때. 지형이 통째로 바뀌므로 좌표도 다시 받는다. */
export const resetOutpost = (
  w: World,
  at: { tx: number; ty: number; turretTx: number; turretTy: number },
): void => {
  w.outpost = { ...at, owner: null, capturing: null, progress: 0, contested: false };
  w.holdTicks = {};
};

/** 누적 점령 시간이 가장 긴 팀. 동률이면 null. */
export const leadingHolder = (w: World): TeamId | null => {
  let best: TeamId | null = null;
  let bestTicks = 0;
  let tie = false;
  for (const [team, ticks] of Object.entries(w.holdTicks)) {
    if (ticks > bestTicks) { bestTicks = ticks; best = Number(team); tie = false; }
    else if (ticks === bestTicks && ticks > 0) tie = true;
  }
  return tie ? null : best;
};

export const holdSeconds = (ticks: number): number => ticks / TICK_HZ;
