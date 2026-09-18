/**
 * 라운드와 페이즈 진행.
 *
 * LOBBY → [ PREP → COMBAT → ROUND_END ] × N → MATCH_END
 *
 * 준비 페이즈에는 중앙이 봉쇄벽으로 막혀 있다. 전투 시작은 그 벽이 사라지는
 * 한 순간으로 표현된다 — 규칙을 설명할 필요 없이 눈으로 보이게 하려는 것.
 */
import { MATCH, PLAYER, RESOURCE } from '../config/balance.js';
import { generateMap } from '../map/generator.js';
import { tileCenter, tileXOf, tileYOf } from '../math.js';
import { Tile } from '../tiles.js';
import type { GameMode } from '../modes/index.js';
import { Phase, type TeamId, type World } from '../types.js';
import { respawn, setTile } from './world.js';
import { resetOutpost } from './outpost.js';
import { dropResource } from './damage.js';

const setPhase = (w: World, phase: Phase, durationTicks: number): void => {
  w.phase = phase;
  w.phaseEndTick = w.tick + durationTicks;
  w.events.push({ t: 'phase', phase, endTick: w.phaseEndTick, round: w.round });
};

/** 라운드 하나를 완전히 초기화한다. 지형까지 새로 만든다. */
export const startRound = (w: World, mode: GameMode): void => {
  w.round += 1;

  // 라운드마다 지형을 새로 뽑는다. 지난 라운드의 땅굴을 물려받으면
  // 먼저 판 쪽이 영구히 유리해진다.
  const map = generateMap({ seed: w.seed ^ (w.round * 0x9e3779b9), mode: w.mode, spawnCount: mode.spawnCount });
  w.tiles = map.tiles;
  w.tileHp = map.tileHp;
  w.spawns = map.spawns;
  w.barrierTiles = map.barrierTiles;
  w.cores = map.cores.map((c) => ({ ...c, hp: 2000, maxHp: 2000 }));
  w.shardNodes = new Map(map.shardNodes.map((t) => [t, 0]));
  resetOutpost(w, map.outpost);

  w.structures.clear();
  w.projectiles.length = 0;
  w.drops.length = 0;

  for (const p of w.players.values()) {
    p.res.ore = 0;
    p.res.shard = 0;
    p.kills = 0;
    p.deaths = 0;
    p.spectating = !p.connected;
    if (p.connected) respawn(w, p);
    else { p.alive = false; p.spectating = true; }
  }

  mode.onRoundStart(w);
  setPhase(w, Phase.PREP, w.prepTicks);
};

/** 봉쇄벽을 무너뜨린다. 전투 페이즈의 시작 신호. */
const dropBarriers = (w: World): void => {
  for (const idx of w.barrierTiles) {
    if (w.tiles[idx] !== Tile.BARRIER) continue;
    setTile(w, tileXOf(idx), tileYOf(idx), Tile.EMPTY);
  }
  w.barrierTiles = [];
};

const endRound = (w: World, winner: TeamId | null): void => {
  if (winner !== null) w.score[winner] = (w.score[winner] ?? 0) + 1;
  w.events.push({ t: 'roundEnd', winner });

  const champion = Object.entries(w.score).find(([, v]) => v >= MATCH.roundsToWin);
  if (champion) {
    w.phase = Phase.MATCH_END;
    w.phaseEndTick = w.tick + MATCH.intermissionTicks;
    w.events.push({ t: 'matchEnd', winner: Number(champion[0]) });
    return;
  }
  setPhase(w, Phase.ROUND_END, MATCH.intermissionTicks);
};

/** 코어 조각 노드가 주기적으로 조각을 뱉는다. 중앙을 비우면 손해가 쌓이게. */
const updateShardNodes = (w: World): void => {
  if (w.phase !== Phase.COMBAT) return;
  for (const [idx, next] of w.shardNodes) {
    if (w.tick < next) continue;
    w.shardNodes.set(idx, w.tick + RESOURCE.shardIntervalTicks);
    dropResource(w, tileCenter(tileXOf(idx)), tileCenter(tileYOf(idx)), 'shard', RESOURCE.shardPerTick);
  }
};

/** 사망자 부활 처리. 부활 정책은 모드가 정한다. */
const updateRespawns = (w: World, mode: GameMode): void => {
  if (!mode.allowsRespawn(w)) {
    for (const p of w.players.values()) {
      if (!p.alive && !p.spectating && p.respawnTick > 0) p.spectating = true;
    }
    return;
  }
  for (const p of w.players.values()) {
    if (p.alive || !p.connected || p.spectating) continue;
    if (p.respawnTick > 0 && w.tick >= p.respawnTick) {
      p.respawnTick = 0;
      respawn(w, p);
    }
  }
};

export const updateMatch = (w: World, mode: GameMode): void => {
  updateShardNodes(w);
  updateRespawns(w, mode);

  switch (w.phase) {
    case Phase.LOBBY:
      break;

    case Phase.PREP:
      if (w.tick >= w.phaseEndTick) {
        dropBarriers(w);
        setPhase(w, Phase.COMBAT, MATCH.combatTicks);
      }
      break;

    case Phase.COMBAT: {
      const outcome = mode.checkRoundEnd(w);
      if (outcome) { endRound(w, outcome.winner); break; }
      if (w.tick >= w.phaseEndTick) endRound(w, mode.onTimeUp(w).winner);
      break;
    }

    case Phase.ROUND_END:
      if (w.tick >= w.phaseEndTick) startRound(w, mode);
      break;

    case Phase.MATCH_END:
      // 끝난 채로 멈춰 있으면 다시 할 길이 없다. 정산 시간이 지나면
      // 로비로 돌려보내 "한 판 더"가 성립하게 한다.
      if (w.tick >= w.phaseEndTick) resetMatch(w);
      break;
  }
};

/** 매치를 처음부터 다시. 로비로 돌아간다. */
export const resetMatch = (w: World): void => {
  w.round = 0;
  w.score = {};
  w.phase = Phase.LOBBY;
  w.phaseEndTick = 0;
  w.holdTicks = {};
  w.outpost.owner = null;
  w.outpost.capturing = null;
  w.outpost.progress = 0;
  w.outpost.contested = false;
  for (const p of w.players.values()) {
    p.alive = false;
    p.spectating = true;
    p.hp = PLAYER.maxHp;
    p.kills = 0;
    p.deaths = 0;
  }
};
