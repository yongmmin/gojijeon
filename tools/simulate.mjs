/**
 * 헤드리스 매치 시뮬레이터.
 *
 * 봇만으로 한 판을 실시간보다 훨씬 빠르게 끝까지 돌려 보고, 무슨 일이
 * 벌어졌는지 숫자로 찍는다. 밸런스를 만진 뒤 "실제로 게임이 굴러가는가"를
 * 5분 기다리지 않고 1초 만에 확인하려고 만들었다.
 *
 *   node tools/simulate.mjs              # 팀전 4인 한 판
 *   node tools/simulate.mjs ffa 6 3      # 개인전 6인, 3판
 *
 * 사전 조건: npm run build:shared && npm run build:server
 */
import {
  MATCH, OUTPOST, Phase, TICK_HZ,
  createPlayer, createWorld, getMode, startRound, stepWorld,
} from '@gojijeon/shared';
import { BotBrain, botName, driveBots } from '../packages/server/dist/room/ai.js';

const [, , modeArg, countArg, runsArg, seedArg] = process.argv;
const MODE = modeArg === 'ffa' ? 'ffa' : 'team';
const COUNT = Math.min(MATCH.maxPlayers, Math.max(2, Number(countArg) || 4));
const RUNS = Math.max(1, Number(runsArg) || 1);
/** 이상한 판이 나왔을 때 그대로 다시 돌릴 수 있어야 한다. */
const FIXED_SEED = seedArg === undefined ? null : Number(seedArg) >>> 0;

/** 한 라운드가 끝날 때까지 돌린다. 안 끝나면 시간 초과로 끊긴다. */
const playRound = (seed) => {
  const mode = getMode(MODE);
  const w = createWorld({ seed, mode: MODE, spawnCount: mode.spawnCount });

  const brains = new Map();
  for (let i = 0; i < COUNT; i++) {
    const id = i + 1;
    createPlayer(w, id, botName(i), mode.assignTeam(w, id), true);
    brains.set(id, new BotBrain(id));
  }
  startRound(w, mode);

  const stats = {
    captures: 0,
    firstCaptureTick: null,
    tilesBroken: 0,
    weaponsFound: 0,
    kills: 0,
    // 고지가 왜 안 먹히는지는 "아무도 안 왔다"와 "와서 서로 막았다"가
    // 완전히 다른 문제다. 둘을 구분할 수 있어야 규칙을 고칠지 봇을 고칠지 안다.
    occupiedTicks: 0,
    contestedTicks: 0,
    maxTeamsOnPoint: 0,
    firstArrivalTick: null,
  };

  const limit = MATCH.prepTicks + MATCH.combatTicks + 40;
  while (w.phase !== Phase.ROUND_END && w.phase !== Phase.MATCH_END && w.tick < limit) {
    driveBots(w, brains);
    stepWorld(w, mode);

    if (w.phase === Phase.COMBAT) {
      const cx = w.outpost.tx * 32 + 16;
      const cy = w.outpost.ty * 32 + 16;
      const teams = new Set();
      for (const p of w.players.values()) {
        if (!p.alive) continue;
        if (Math.hypot(p.x - cx, p.y - cy) <= OUTPOST.radius) teams.add(p.team);
      }
      if (teams.size > 0) {
        stats.occupiedTicks++;
        if (stats.firstArrivalTick === null) stats.firstArrivalTick = w.tick;
      }
      if (teams.size > 1) stats.contestedTicks++;
      if (teams.size > stats.maxTeamsOnPoint) stats.maxTeamsOnPoint = teams.size;
    }
    for (const e of w.events) {
      if (e.t === 'tileBroken') stats.tilesBroken++;
      else if (e.t === 'loot') stats.weaponsFound++;
      else if (e.t === 'death') stats.kills++;
      else if (e.t === 'capture') {
        stats.captures++;
        if (stats.firstCaptureTick === null) stats.firstCaptureTick = w.tick;
      }
    }
  }

  const secs = (t) => (t / TICK_HZ).toFixed(0);
  const hold = Object.entries(w.holdTicks)
    .sort((a, b) => b[1] - a[1])
    .map(([team, t]) => `${team}팀 ${secs(t)}초`)
    .join(' · ') || '없음';

  return {
    seed,
    phase: w.phase,
    length: `${secs(w.tick)}초`,
    score: w.score,
    hold,
    owner: w.outpost.owner,
    cores: w.cores.map((c) => `${c.team}팀 ${c.hp}/${c.maxHp}`).join(' · ') || '없음',
    ...stats,
    firstCapture: stats.firstCaptureTick === null ? '없음' : `${secs(stats.firstCaptureTick)}초`,
    firstArrival: stats.firstArrivalTick === null ? '없음' : `${secs(stats.firstArrivalTick)}초`,
  };
};

const secsOf = (ticks) => (ticks / TICK_HZ).toFixed(0);

console.log(`${MODE === 'ffa' ? '개인전' : '팀전'} ${COUNT}인 × ${RUNS}판\n`);

for (let i = 0; i < RUNS; i++) {
  const seed = FIXED_SEED ?? ((Math.random() * 0xffffffff) >>> 0);
  const t0 = Date.now();
  const r = playRound(seed);
  const wall = Date.now() - t0;
  console.log(`[${i + 1}] seed ${r.seed} — ${r.length} 만에 ${r.phase} (계산 ${wall}ms)`);
  console.log(`    고지: 첫 점령 ${r.firstCapture} · 주인 바뀜 ${r.captures}회 · 최종 ${r.owner === null ? '중립' : `${r.owner}팀`}`);
  console.log(`    보유: ${r.hold}`);
  console.log(`    코어: ${r.cores}`);
  console.log(`    현장: 첫 도착 ${r.firstArrival} · 누가 서 있던 시간 ${secsOf(r.occupiedTicks)}초 (그중 경합 ${secsOf(r.contestedTicks)}초) · 동시 최대 ${r.maxTeamsOnPoint}팀`);
  console.log(`    굴착 ${r.tilesBroken}칸 · 무기 발굴 ${r.weaponsFound}개 · 사망 ${r.kills}회`);
  console.log(`    점수: ${JSON.stringify(r.score)}\n`);
}

console.log(`참고: 점령에 ${OUTPOST.captureTicks / TICK_HZ}초, 준비 페이즈 ${MATCH.prepTicks / TICK_HZ}초.`);
console.log('이상한 판은 seed를 네 번째 인자로 넘기면 그대로 재현된다.  예) npm run sim ffa 6 1 123456');
