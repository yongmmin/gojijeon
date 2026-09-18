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
   * **점령했으면 지키러 서 있지 않아도 된다.**
   *
   * 예전에는 그 자리에 서 있는 동안만 시간이 쌓였다. 그래서 고지를 먹고도
   * 한 발짝도 못 움직였고, 점령이라기보다 인질극에 가까웠다.
   *
   * 지금은 **주인인 동안 계속 쌓인다.** 멈추는 경우는 하나뿐이다 —
   * **적이 고지에 올라와 있을 때.** 뺏기려면 남이 와야 하고, 시계를 멈추려면
   * 적어도 발은 들여놔야 한다. 규칙이 한 문장으로 끝난다.
   */
  const enemyOnPoint = teams.some((t) => t !== o.owner);
  if (o.owner !== null && !enemyOnPoint) {
    w.holdTicks[o.owner] = (w.holdTicks[o.owner] ?? 0) + 1;
  } else if (o.owner === null && teams.length === 1) {
    // 아직 주인이 없을 때는 혼자 서 있는 사람이 쌓는다. 개인전에서 아무도
    // 점령을 끝내지 못한 채 판이 통째로 멈추는 것을 막는 장치다.
    w.holdTicks[teams[0]] = (w.holdTicks[teams[0]] ?? 0) + 1;
  }

  if (o.contested) return;

  if (teams.length === 0) {
    // 주인이 있으면 자리를 비워도 게이지가 꽉 찬 채로 남는다. 내 것이니까.
    if (o.owner !== null) { o.progress = 1; o.capturing = o.owner; return; }
    // 주인이 없을 때만 되돌아간다. 잠깐 들렀다 간 사람의 진행도가 라운드
    // 내내 남아 있으면 마지막 1초 날치기가 가능해진다.
    o.progress = Math.max(0, o.progress - OUTPOST.decayPerTick);
    if (o.progress === 0) o.capturing = null;
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
