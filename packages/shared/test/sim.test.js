/**
 * 시뮬레이션 계약 테스트.
 *
 * 렌더도 소켓도 없이 순수하게 규칙만 돌린다. 이 파일이 초록이면
 * "게임이 게임으로서 성립한다"는 뜻이고, 클라이언트 버그와 규칙 버그를
 * 구분할 수 있게 된다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Button, LOOT, LOOT_POOL, MAP_TILES, MATCH, MINING, OUTPOST, PLAYER, Phase, RESOURCE, ZONE,
  STRUCTURES, TICK_HZ, TILE, TILES, Tile, WeaponId, looksDiggable, secs,
  WEAPONS, applyAction, build, circleFits, createPlayer, createWorld, decodeRLE, dropHeld,
  damageTile, dropHealth, dropResource, dropWeapon, encodeRLE, ffaMode, generateMap, getTile,
  killPlayer, lootOdds, pickSpawn,
  ModeId, pickup, respawn, rollTileHealth,
  isZoneShrinking, rollTileLoot, rollWeapon, standings, startRound, stepWorld, swingSeconds,
  teamMode, zoneCenter, zoneRadius,
  tileCenter, tileDps,
  tileIndex,
} from '@gojijeon/shared';

// ── 도우미 ───────────────────────────────────────────────────────────────────

/** 전투 페이즈에서 시작하는 월드. 라운드 진행에 방해받지 않게 종료를 멀리 둔다. */
const combatWorld = (mode = teamMode, seed = 1234) => {
  const w = createWorld({ seed, mode: mode.id, spawnCount: mode.spawnCount });
  w.phase = Phase.COMBAT;
  w.phaseEndTick = 1_000_000;
  return w;
};

const addPlayerAt = (w, id, team, tx, ty, weapon = WeaponId.PICKAXE) => {
  const p = createPlayer(w, id, `p${id}`, team);
  p.alive = true;
  p.spectating = false;
  p.x = tileCenter(tx);
  p.y = tileCenter(ty);
  p.weapon = weapon;
  p.invulnUntilTick = 0;
  return p;
};

/** 플레이어 주위를 비워 충돌·시야 변수를 제거한다. */
const clearArea = (w, tx, ty, r) => {
  for (let y = ty - r; y <= ty + r; y++) {
    for (let x = tx - r; x <= tx + r; x++) {
      const i = tileIndex(x, y);
      if (i >= 0 && i < w.tiles.length) { w.tiles[i] = Tile.EMPTY; w.tileHp[i] = 0; }
    }
  }
};

const run = (w, mode, ticks) => { for (let i = 0; i < ticks; i++) stepWorld(w, mode); };

const hold = (p, buttons) => { p.input.buttons = buttons; };

// ── 맵 ───────────────────────────────────────────────────────────────────────

test('맵 생성은 결정적이다 — 같은 시드면 바이트까지 같다', () => {
  const a = generateMap({ seed: 42, mode: ModeId.TEAM, spawnCount: 2 });
  const b = generateMap({ seed: 42, mode: ModeId.TEAM, spawnCount: 2 });
  assert.deepEqual([...a.tiles], [...b.tiles]);
  const c = generateMap({ seed: 43, mode: ModeId.TEAM, spawnCount: 2 });
  assert.notDeepEqual([...a.tiles], [...c.tiles]);
});

test('모든 스폰 지점에 플레이어가 실제로 설 수 있다', () => {
  for (const mode of [teamMode, ffaMode]) {
    const w = createWorld({ seed: 7, mode: mode.id, spawnCount: mode.spawnCount });
    assert.ok(w.spawns.length >= 2, `${mode.id}: 스폰이 부족하다`);
    for (const s of w.spawns) {
      assert.ok(
        circleFits(w, s.x, s.y, PLAYER.radius, 0),
        `${mode.id}: 스폰 (${s.x}, ${s.y})이 벽에 끼어 있다`,
      );
    }
  }
});

test('팔 수 있는 타일과 못 파는 타일은 색으로 구분된다', () => {
  // 플레이테스터가 "남색 벽돌은 못 깨부수는 거냐"고 물었다. 바닥과 암반이
  // 둘 다 남색이었기 때문이다. 규칙을 못 박는다: 따뜻하면 팔 수 있다.
  for (const def of Object.values(TILES)) {
    // 빛나는 특수물과, 색을 제 레지스트리에서 가져오는 건축물은 예외다.
    if (def.id === Tile.SHARD_NODE || def.id === Tile.OUTPOST) continue;
    if (def.id === Tile.STRUCTURE) continue;
    if (def.mineable) {
      assert.ok(looksDiggable(def), `${def.name}(${def.color})은 팔 수 있는데 차가운 색이다`);
    } else {
      assert.ok(!looksDiggable(def), `${def.name}(${def.color})은 못 파는데 따뜻한 색이라 팔 수 있어 보인다`);
    }
  }
});

test('바닥과 암반은 밝기로도 확실히 갈린다', () => {
  // 색상만 다르고 밝기가 비슷하면 어두운 화면에서 다시 섞여 보인다.
  const lum = (hex) => {
    const v = parseInt(hex.slice(1), 16);
    return 0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255);
  };
  const gap = lum(TILES[Tile.HARD_WALL].color) - lum(TILES[Tile.EMPTY].color);
  assert.ok(gap > 40, `바닥과 암반의 밝기 차이가 ${gap.toFixed(0)}뿐이다 — 벽인지 구멍인지 모른다`);
});

test('준비 시간은 중앙까지 뛰어갈 만큼만 짧다', () => {
  // 이 시간 동안은 고지에 닿을 수조차 없으므로, 길면 그냥 죽은 시간이다.
  const seconds = MATCH.prepTicks / TICK_HZ;
  assert.ok(seconds <= 15, `준비 ${seconds}초 — 아무것도 못 하는 시간이 너무 길다`);
  assert.ok(seconds >= 5, '기지에서 나올 시간은 줘야 한다');
});

test('맵 외곽은 절대 뚫리지 않는다', () => {
  const w = createWorld({ seed: 9, mode: ModeId.FFA });
  for (let i = 0; i < MAP_TILES; i++) {
    for (const [tx, ty] of [[0, i], [i, 0], [MAP_TILES - 1, i], [i, MAP_TILES - 1]]) {
      assert.equal(getTile(w, tx, ty), Tile.HARD_WALL);
    }
  }
});

/**
 * 파서라도 갈 수 있는 칸인가.
 * 전투 페이즈 기준이라 봉쇄벽은 이미 무너진 것으로 본다.
 */
const passableByDigging = (id) =>
  id === Tile.EMPTY || id === Tile.SOFT_WALL || id === Tile.ORE_VEIN ||
  id === Tile.OUTPOST || id === Tile.BARRIER;

test('어떤 스폰에서도 고지까지 갈 수 있다 — 파서라도', () => {
  // 지형 생성이 무작위라 특정 시드에서만 갇히는 맵이 나올 수 있다. 실제로
  // 6분 동안 아무도 중앙에 못 간 판을 시뮬레이터에서 한 번 봤고, 그 판의
  // 시드를 잡지 못해 원인을 못 밝혔다. 그래서 불변조건으로 못 박는다.
  for (const mode of [teamMode, ffaMode]) {
    for (let seed = 1; seed <= 40; seed++) {
      const w = createWorld({ seed, mode: mode.id, spawnCount: mode.spawnCount });
      const goal = tileIndex(w.outpost.tx, w.outpost.ty);

      const seen = new Uint8Array(w.tiles.length);
      const queue = [];
      for (const sp of w.spawns) {
        const i = tileIndex(Math.floor(sp.x / TILE), Math.floor(sp.y / TILE));
        if (!seen[i]) { seen[i] = 1; queue.push(i); }
      }

      for (let head = 0; head < queue.length; head++) {
        const i = queue[head];
        const x = i % MAP_TILES;
        const y = (i / MAP_TILES) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= MAP_TILES || ny >= MAP_TILES) continue;
          const ni = tileIndex(nx, ny);
          if (seen[ni] || !passableByDigging(w.tiles[ni])) continue;
          seen[ni] = 1;
          queue.push(ni);
        }
      }

      assert.equal(
        seen[goal], 1,
        `${mode.id} seed ${seed}: 스폰에서 고지까지 파서도 갈 수 없다 — 그 판은 6분이 그냥 흐른다`,
      );
    }
  }
});

test('스폰에서 고지까지 파지 않고도 갈 수 있다 — 진입로가 실제로 이어져 있다', () => {
  // 위 테스트는 "파면 간다"만 본다. 진입로가 끊겨 있어도 통과한다.
  // 전투 시작 직후의 돌진이 성립하려면 빈 칸만 밟고도 닿아야 한다.
  for (const mode of [teamMode, ffaMode]) {
    for (let seed = 1; seed <= 20; seed++) {
      const w = createWorld({ seed, mode: mode.id, spawnCount: mode.spawnCount });
      const goal = tileIndex(w.outpost.tx, w.outpost.ty);
      // 봉쇄벽은 전투 시작과 함께 사라지므로 빈 칸으로 친다.
      const open = (id) => id === Tile.EMPTY || id === Tile.OUTPOST || id === Tile.BARRIER;

      const seen = new Uint8Array(w.tiles.length);
      const queue = [];
      for (const sp of w.spawns) {
        const i = tileIndex(Math.floor(sp.x / TILE), Math.floor(sp.y / TILE));
        if (!seen[i]) { seen[i] = 1; queue.push(i); }
      }
      for (let head = 0; head < queue.length; head++) {
        const i = queue[head];
        const x = i % MAP_TILES, y = (i / MAP_TILES) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= MAP_TILES || ny >= MAP_TILES) continue;
          const ni = tileIndex(nx, ny);
          if (seen[ni] || !open(w.tiles[ni])) continue;
          seen[ni] = 1;
          queue.push(ni);
        }
      }

      assert.equal(
        seen[goal], 1,
        `${mode.id} seed ${seed}: 진입로가 끊겨 있다 — 중앙에 닿는 데 1~2분이 걸린다`,
      );
    }
  }
});

/**
 * 실제 충돌 판정으로 걸어서 고지에 닿는가.
 *
 * 타일 단위 연결성 테스트는 이걸 못 잡는다. 칸이 이어져 있어도 반지름 11px짜리
 * 몸이 지나갈 수 없으면 플레이어에게는 막힌 것과 같다. 반칸 격자로 BFS 한다.
 */
const walkableToOutpost = (w, from, team) => {
  const STEP = TILE / 2;
  const key = (x, y) => `${Math.round(x / STEP)},${Math.round(y / STEP)}`;
  const gx = tileCenter(w.outpost.tx);
  const gy = tileCenter(w.outpost.ty);
  const seen = new Set([key(from.x, from.y)]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head];
    if (Math.hypot(p.x - gx, p.y - gy) < TILE) return true;
    for (const [dx, dy] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]]) {
      const nx = p.x + dx, ny = p.y + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_TILES * TILE || ny >= MAP_TILES * TILE) continue;
      const k = key(nx, ny);
      if (seen.has(k) || !circleFits(w, nx, ny, PLAYER.radius, team)) continue;
      seen.add(k);
      queue.push({ x: nx, y: ny });
    }
  }
  return false;
};

test('전투가 시작되면 몸이 실제로 고지까지 걸어갈 수 있다', () => {
  // "중앙 타워 쪽으로 가지를 못한다"는 보고를 받고 넣었다. 그때 원인은
  // 봉쇄벽이었지만, 진입로 폭이 몸보다 좁아지는 회귀는 이 검사만 잡는다.
  for (const mode of [teamMode, ffaMode]) {
    for (let seed = 1; seed <= 12; seed++) {
      const w = createWorld({ seed, mode: mode.id, spawnCount: mode.spawnCount });
      createPlayer(w, 1, 'a', 0);
      createPlayer(w, 2, 'b', 1);
      startRound(w, mode);
      // 전투 시작 = 봉쇄벽이 무너진 상태.
      for (const idx of w.barrierTiles) w.tiles[idx] = Tile.EMPTY;

      for (const sp of w.spawns) {
        assert.ok(
          walkableToOutpost(w, { x: sp.x, y: sp.y }, sp.team),
          `${mode.id} seed ${seed}: ${sp.team}팀 스폰에서 고지까지 몸이 지나갈 수 없다`,
        );
      }
    }
  }
});

test('준비 페이즈에는 봉쇄벽이 실제로 중앙을 막는다', () => {
  // 위 테스트의 짝. 막혀 있어야 할 때 막혀 있는지도 확인해야
  // "봉쇄벽이 하는 일이 없다"는 반대쪽 회귀를 잡는다.
  for (let seed = 1; seed <= 8; seed++) {
    const w = createWorld({ seed, mode: ModeId.TEAM, spawnCount: 2 });
    createPlayer(w, 1, 'a', 0);
    createPlayer(w, 2, 'b', 1);
    startRound(w, teamMode);
    const sp = w.spawns.find((s) => s.team === 0);
    assert.equal(
      walkableToOutpost(w, { x: sp.x, y: sp.y }, 0), false,
      `seed ${seed}: 준비 중인데 고지까지 걸어갈 수 있다`,
    );
  }
});

test('팀전 맵은 팀마다 코어를 하나씩 준다', () => {
  const w = createWorld({ seed: 11, mode: ModeId.TEAM, spawnCount: 2 });
  assert.equal(w.cores.length, 2);
  assert.deepEqual(w.cores.map((c) => c.team).sort(), [0, 1]);
});

test('RLE는 원본을 손실 없이 복원한다', () => {
  const w = createWorld({ seed: 5, mode: ModeId.TEAM });
  const restored = decodeRLE(encodeRLE(w.tiles), w.tiles.length);
  assert.deepEqual([...restored], [...w.tiles]);
  // 압축이 의미가 있어야 한다. 원본보다 커지면 설계가 틀린 것이다.
  assert.ok(encodeRLE(w.tiles).length < w.tiles.length, '압축 후가 더 크다');
});

// ── 굴착 ─────────────────────────────────────────────────────────────────────

test('곡괭이로 흙벽을 파면 뚫리고 광석이 들어온다', () => {
  const w = combatWorld();
  const tx = 40, ty = 40;
  clearArea(w, tx, ty, 2);
  w.tiles[tileIndex(tx + 2, ty)] = Tile.SOFT_WALL;
  w.tileHp[tileIndex(tx + 2, ty)] = 30;

  const p = addPlayerAt(w, 1, 0, tx, ty, WeaponId.PICKAXE);
  p.input.aim = 0; // 오른쪽
  hold(p, Button.PRIMARY);

  run(w, teamMode, 60);

  assert.equal(getTile(w, tx + 2, ty), Tile.EMPTY, '벽이 안 뚫렸다');
  assert.ok(p.res.ore > 0, '광석이 안 들어왔다');
});

test('무기를 들고 파는 속도는 무기 종류와 무관하게 곡괭이의 일정 비율이다', () => {
  // 벽을 바로 옆 칸에 둔다. 곡괭이는 2칸 밖에서도 닿지만 무기는 제 근접
  // 사거리까지만 닿기 때문에(이것도 곡괭이를 드는 이유다), 사거리 차이를
  // 빼고 순수한 속도만 비교하려면 둘 다 닿는 거리에 세워야 한다.
  const ticksToBreak = (weapon) => {
    const w = combatWorld();
    const tx = 40, ty = 40;
    clearArea(w, tx, ty, 2);
    const wall = tileIndex(tx + 1, ty);
    w.tiles[wall] = Tile.SOFT_WALL;
    w.tileHp[wall] = 30;
    const p = addPlayerAt(w, 1, 0, tx, ty, weapon);
    p.input.aim = 0;
    hold(p, Button.PRIMARY);
    for (let t = 1; t <= 600; t++) {
      stepWorld(w, teamMode);
      if (getTile(w, tx + 1, ty) === Tile.EMPTY) return t;
    }
    return Infinity;
  };

  const pick = ticksToBreak(WeaponId.PICKAXE);
  assert.ok(Number.isFinite(pick), '곡괭이로 못 뚫었다');

  // 휘두르는 주기가 제각각인 무기들. 전부 곡괭이 대비 같은 비율이어야 한다.
  // (주기가 짧은 단검이 우연히 좋은 곡괭이가 되는 회귀를 잡는 테스트다.)
  const expected = 1 / MINING.nonPickaxeMultiplier;
  for (const weapon of [WeaponId.DAGGER, WeaponId.SPEAR, WeaponId.SHIELD]) {
    const ratio = ticksToBreak(weapon) / pick;
    assert.ok(
      ratio > expected * 0.65 && ratio < expected * 1.5,
      `${weapon}: 곡괭이의 ${ratio.toFixed(1)}배 — 기대 ${expected.toFixed(1)}배 근처`,
    );
  }
  assert.ok(MINING.nonPickaxeMultiplier > 0, '무기로 아예 못 파면 자기 벽에 갇힐 수 있다');
});

test('망치는 곡괭이보다 느리지만 아무 무기보다는 잘 판다 — 건설가의 자리', () => {
  const pick = tileDps(WEAPONS.pickaxe);
  assert.ok(tileDps(WEAPONS.hammer) < pick, '망치가 곡괭이를 대체해 버린다');
  assert.ok(
    tileDps(WEAPONS.hammer) > pick * MINING.nonPickaxeMultiplier,
    '망치가 단검보다도 땅을 못 판다 — 도구라고 부를 수 없다',
  );
});

test('곡괭이는 무기보다 멀리서 팔 수 있다', () => {
  // 사거리 차이 자체가 곡괭이를 드는 또 하나의 이유다.
  assert.ok(MINING.range > MINING.minReach, '곡괭이가 최소 사거리보다 짧다');
  assert.ok(MINING.range > WEAPONS.dagger.range);
});

test('어떤 무기를 들어도 벽에 코를 박지 않고 팔 수 있다', () => {
  // 사거리가 짧은 무기로도 한 칸 떨어져서 팔 수 있어야 한다. 아니면 굴착이
  // 선택이 아니라 조작 정확도 시험이 된다.
  const w = combatWorld();
  const tx = 40, ty = 40;
  clearArea(w, tx, ty, 3);
  const wall = tileIndex(tx + 1, ty);
  w.tiles[wall] = Tile.SOFT_WALL;
  w.tileHp[wall] = 30;

  // 벽에서 한 칸 떨어진 자리(사거리가 가장 짧은 방패로)
  const p = addPlayerAt(w, 1, 0, tx, ty, WeaponId.SHIELD);
  assert.ok(MINING.minReach > WEAPONS.shield.range, '이 테스트가 무의미해졌다');
  p.input.aim = 0;
  hold(p, Button.PRIMARY);
  run(w, teamMode, 120);

  assert.equal(getTile(w, tx + 1, ty), Tile.EMPTY, '사거리가 짧은 무기로는 못 판다');
});

test('무기로 파는 속도가 곡괭이의 3분의 1 밑으로 내려가지 않는다', () => {
  // 여기를 밑돌면 무기를 줍는 것이 이득이 아니라 벌이 된다. 실제로 한 번
  // 그렇게 만들었다가 "무기를 주우면 땅을 못 판다"는 피드백을 받았다.
  assert.ok(
    MINING.nonPickaxeMultiplier >= 0.34,
    `현재 ${(MINING.nonPickaxeMultiplier * 100).toFixed(0)}% — 무기를 들면 사실상 굴착 불가`,
  );
  // 반대로 1에 가까우면 곡괭이를 들 이유가 사라져 "버릴 것인가"라는 선택이 없어진다.
  assert.ok(MINING.nonPickaxeMultiplier <= 0.75, '곡괭이가 존재 이유를 잃는다');
});

test('암반은 어떤 공격으로도 깎이지 않는다', () => {
  const w = combatWorld();
  const tx = 40, ty = 40;
  clearArea(w, tx, ty, 2);
  const rock = tileIndex(tx + 2, ty);
  w.tiles[rock] = Tile.HARD_WALL;
  const p = addPlayerAt(w, 1, 0, tx, ty, WeaponId.PICKAXE);
  p.input.aim = 0;
  hold(p, Button.PRIMARY);
  run(w, teamMode, 120);
  assert.equal(getTile(w, tx + 2, ty), Tile.HARD_WALL);
});

// ── 전투 ─────────────────────────────────────────────────────────────────────

test('근접 공격은 정면의 적에게만 맞는다', () => {
  const w = combatWorld();
  clearArea(w, 40, 40, 4);
  const a = addPlayerAt(w, 1, 0, 40, 40, WeaponId.DAGGER);
  const front = addPlayerAt(w, 2, 1, 41, 40);
  const behind = addPlayerAt(w, 3, 1, 39, 40);
  a.input.aim = 0; // 오른쪽 = front 방향
  hold(a, Button.PRIMARY);

  run(w, teamMode, 8);

  assert.ok(front.hp < PLAYER.maxHp, '정면의 적이 안 맞았다');
  assert.equal(behind.hp, PLAYER.maxHp, '등 뒤의 적이 맞았다');
});

test('몸이 붙으면 각도와 무관하게 맞는다', () => {
  // 4px 떨어진 상대가 옆으로 조금만 움직여도 조준 각이 60° 벌어져서,
  // 분명히 맞붙어 있는데 헛스윙이 나던 문제. 실측으로 확인하고 고쳤다.
  for (const deg of [0, 60, 90, 135, 180]) {
    const w = combatWorld();
    clearArea(w, 40, 40, 3);
    const a = addPlayerAt(w, 1, 0, 40, 40, WeaponId.DAGGER);
    const foe = addPlayerAt(w, 2, 1, 40, 40);
    const r = (deg * Math.PI) / 180;
    foe.x = a.x + Math.cos(r) * 6;
    foe.y = a.y + Math.sin(r) * 6;
    a.input.aim = 0;
    hold(a, Button.PRIMARY);
    run(w, teamMode, 20);
    assert.ok(foe.hp < PLAYER.maxHp, `몸이 겹쳤는데 ${deg}° 방향이라고 안 맞는다`);
  }
});

test('멀어지면 다시 부채꼴을 따진다', () => {
  // 근접 예외가 사거리 전체로 번지면 등 뒤도 맞는 무기가 된다.
  const w = combatWorld();
  clearArea(w, 40, 40, 4);
  const a = addPlayerAt(w, 1, 0, 40, 40, WeaponId.DAGGER);
  const behind = addPlayerAt(w, 2, 1, 40, 40);
  behind.x = a.x - 30;
  a.input.aim = 0;
  hold(a, Button.PRIMARY);
  run(w, teamMode, 20);
  assert.equal(behind.hp, PLAYER.maxHp, '등 뒤의 적이 맞았다');
});

test('같은 팀은 때릴 수 없다', () => {
  const w = combatWorld();
  clearArea(w, 40, 40, 4);
  const a = addPlayerAt(w, 1, 0, 40, 40, WeaponId.SPEAR);
  const mate = addPlayerAt(w, 2, 0, 41, 40);
  a.input.aim = 0;
  hold(a, Button.PRIMARY);
  run(w, teamMode, 30);
  assert.equal(mate.hp, PLAYER.maxHp);
});

test('방패는 정면만 막는다 — 뒤를 잡히면 짐이다', () => {
  const hit = (defenderAim) => {
    const w = combatWorld();
    clearArea(w, 40, 40, 4);
    const attacker = addPlayerAt(w, 1, 0, 40, 40, WeaponId.SPEAR);
    const defender = addPlayerAt(w, 2, 1, 41, 40, WeaponId.SHIELD);
    defender.aim = defenderAim;
    defender.input.aim = defenderAim;
    attacker.input.aim = 0;
    hold(attacker, Button.PRIMARY);
    run(w, teamMode, 12);
    return PLAYER.maxHp - defender.hp;
  };
  const facing = hit(Math.PI);   // 공격자 쪽을 본다
  const turned = hit(0);         // 등을 돌렸다
  assert.ok(facing > 0, '방패가 피해를 완전히 0으로 만들면 안 된다');
  assert.ok(turned > facing * 2, `등 뒤 피해(${turned})가 정면(${facing})보다 충분히 커야 한다`);
});

test('죽으면 들고 있던 무기가 바닥에 떨어지고, 남이 주울 수 있다', () => {
  const w = combatWorld();
  clearArea(w, 40, 40, 4);
  const killer = addPlayerAt(w, 1, 0, 40, 40, WeaponId.SPEAR);
  const victim = addPlayerAt(w, 2, 1, 41, 40, WeaponId.BOW);
  victim.hp = 5;
  killer.input.aim = 0;
  hold(killer, Button.PRIMARY);

  run(w, teamMode, 12);

  assert.equal(victim.alive, false, '안 죽었다');
  assert.equal(killer.kills, 1);
  const dropped = w.drops.find((d) => d.kind === 'weapon' && d.weapon === WeaponId.BOW);
  assert.ok(dropped, '활이 안 떨어졌다');

  // 킬러가 전리품을 줍는다. 들고 있던 창은 그 자리에 떨어져야 한다.
  killer.x = dropped.x;
  killer.y = dropped.y;
  w.tick = dropped.pickupTick;
  assert.equal(pickup(w, killer).ok, true);
  assert.equal(killer.weapon, WeaponId.BOW);
  assert.ok(w.drops.some((d) => d.weapon === WeaponId.SPEAR), '들고 있던 창이 안 떨어졌다');
});

test('폭탄은 벽을 지우고, 쓰고 나면 맨손이 된다', () => {
  const w = combatWorld();
  clearArea(w, 40, 40, 6);
  // 오른쪽에 흙벽 기둥을 세운다.
  for (let dy = -2; dy <= 2; dy++) {
    const i = tileIndex(44, 40 + dy);
    w.tiles[i] = Tile.SOFT_WALL;
    w.tileHp[i] = 30;
  }
  const p = addPlayerAt(w, 1, 0, 40, 40, WeaponId.BOMB);
  p.input.aim = 0;
  hold(p, Button.PRIMARY);

  run(w, teamMode, 60);

  assert.equal(p.weapon, null, '폭탄이 소모되지 않았다');
  const stillWall = [-2, -1, 0, 1, 2].filter((dy) => getTile(w, 44, 40 + dy) === Tile.SOFT_WALL);
  assert.ok(stillWall.length < 5, '폭탄이 벽을 전혀 못 지웠다');
});

test('활은 투사체를 날려 멀리 있는 적을 죽인다', () => {
  const w = combatWorld();
  clearArea(w, 40, 40, 10);
  const archer = addPlayerAt(w, 1, 0, 40, 40, WeaponId.BOW);
  const target = addPlayerAt(w, 2, 1, 46, 40);
  target.hp = 20;
  archer.input.aim = 0;
  hold(archer, Button.PRIMARY);

  // 화살이 실제로 날아가는 중간 상태가 있어야 한다. 즉발이면 원거리가 아니다.
  let sawFlight = false;
  for (let t = 0; t < 40 && target.alive; t++) {
    stepWorld(w, teamMode);
    if (w.projectiles.length > 0) sawFlight = true;
  }

  assert.ok(sawFlight, '화살이 날아가는 프레임이 하나도 없었다');
  assert.equal(target.alive, false, '화살에 맞아도 안 죽는다');
  assert.equal(archer.kills, 1);
});

test('화살은 벽을 통과하지 못한다', () => {
  const w = combatWorld();
  clearArea(w, 40, 40, 10);
  for (let dy = -3; dy <= 3; dy++) {
    const i = tileIndex(43, 40 + dy);
    w.tiles[i] = Tile.HARD_WALL;
  }
  const archer = addPlayerAt(w, 1, 0, 40, 40, WeaponId.BOW);
  const target = addPlayerAt(w, 2, 1, 46, 40);
  archer.input.aim = 0;
  hold(archer, Button.PRIMARY);
  run(w, teamMode, 60);

  assert.equal(target.hp, PLAYER.maxHp, '화살이 암반을 뚫고 갔다');
});

test('부활하면 손에 든 것이 곡괭이로 초기화된다', () => {
  const w = combatWorld();
  clearArea(w, 40, 40, 4);
  const killer = addPlayerAt(w, 1, 0, 40, 40, WeaponId.SPEAR);
  const victim = addPlayerAt(w, 2, 1, 41, 40, WeaponId.BOW);
  victim.hp = 5;
  victim.res.ore = 100;
  killer.input.aim = 0;
  hold(killer, Button.PRIMARY);

  run(w, teamMode, 12);
  assert.equal(victim.alive, false);
  assert.equal(victim.weapon, null, '죽었는데 무기를 쥐고 있다');

  // 죽은 자리에 활이 떨어져 있어야 한다 — 되찾으러 갈 수 있어야 하므로.
  assert.ok(w.drops.some((d) => d.weapon === WeaponId.BOW), '활이 안 떨어졌다');

  run(w, teamMode, PLAYER.respawnTicks + 2);

  assert.equal(victim.alive, true, '팀전인데 부활을 안 했다');
  assert.equal(victim.weapon, WeaponId.PICKAXE, '부활했는데 무기가 초기화되지 않았다');
  assert.equal(victim.hp, PLAYER.maxHp);
});

test('부활 자리는 기지 안이다 — 죽은 자리에서 다시 서지 않는다', () => {
  const w = combatWorld();
  clearArea(w, 40, 40, 4);
  const victim = addPlayerAt(w, 2, 1, 40, 40);
  killPlayer(w, victim, 1);
  run(w, teamMode, PLAYER.respawnTicks + 2);

  const nearAnySpawn = w.spawns
    .filter((sp) => sp.team === victim.team)
    .some((sp) => Math.hypot(victim.x - sp.x, victim.y - sp.y) < TILE);
  assert.ok(nearAnySpawn, '기지가 아닌 곳에서 부활했다');
});

// ── 전리품(무기 드랍) ────────────────────────────────────────────────────────

test('무기는 만들 수 없다 — 제작 액션 자체가 없다', () => {
  const w = combatWorld();
  clearArea(w, 40, 40, 2);
  const p = addPlayerAt(w, 1, 0, 40, 40);
  p.res.ore = 9999;
  p.res.shard = 9999;
  // 옛 클라이언트가 남아 있어도 서버가 조용히 무시해야 한다.
  const r = applyAction(w, p, { type: 'craft', weapon: WeaponId.BOW });
  assert.equal(r?.ok ?? false, false);
  assert.equal(p.weapon, WeaponId.PICKAXE, '제작이 통했다');
});

test('가중치 추첨은 표의 비율을 따른다', () => {
  // 경계값을 직접 지목한다. 0은 첫 항목, 1에 가까우면 마지막 항목.
  assert.equal(rollWeapon(0), LOOT_POOL[0].id);
  assert.equal(rollWeapon(0.999999), LOOT_POOL[LOOT_POOL.length - 1].id);

  const odds = lootOdds();
  const total = odds.reduce((n, o) => n + o.percent, 0);
  assert.ok(Math.abs(total - 100) < 0.001, `확률 합이 ${total}%`);
  // 곡괭이는 땅에서 나오지 않는다. 이미 들고 시작하므로 꽝이 된다.
  assert.equal(odds.some((o) => o.id === WeaponId.PICKAXE), false);
});

test('어느 무기도 드랍 표를 독차지하지 않는다', () => {
  // 단검이 30%였을 때 "단검만 너무 많이 뜬다"는 말이 나왔다.
  // 한 무기가 4분의 1을 넘으면 발굴이 뽑기가 아니라 확정에 가까워진다.
  for (const o of lootOdds()) {
    assert.ok(
      o.percent <= 25,
      `${WEAPONS[o.id].name}가 ${o.percent.toFixed(0)}% — 이것만 계속 나온다`,
    );
  }
  // 반대로 너무 희귀하면 존재를 모르게 된다.
  for (const o of lootOdds()) {
    assert.ok(o.percent >= 5, `${WEAPONS[o.id].name}가 ${o.percent.toFixed(0)}% — 평생 못 본다`);
  }
});

test('표창은 활과 근접 사이를 메운다', () => {
  const dps = (w) => (w.projectile ? w.projectile.damage : w.damage) / swingSeconds(w);
  const star = WEAPONS.shuriken;

  assert.equal(star.kind, 'ranged');
  assert.ok(star.projectile, '표창인데 날아가는 것이 없다');

  // 사거리: 근접보다 멀고 활보다 짧다.
  assert.ok(star.range > WEAPONS.spear.range, '창보다 가까우면 원거리라 할 수 없다');
  assert.ok(star.range < WEAPONS.bow.range, '활만큼 멀면 활을 들 이유가 없다');

  // 위력: 활보다 세고 창보다 약하다. 안전한 거리에서 쏘는 대가다.
  assert.ok(dps(star) > dps(WEAPONS.bow), '활보다 약하면 가까이 갈 이유가 없다');
  assert.ok(dps(star) < dps(WEAPONS.spear), '창보다 세면 근접을 들 이유가 없다');
});

test('새 무기는 표에 넣는 것만으로 드랍에 들어간다', () => {
  // 레지스트리가 진실이라는 규칙의 확인. 추첨 표는 dropWeight에서 파생된다.
  const pool = LOOT_POOL.map((w) => w.id);
  assert.ok(pool.includes(WeaponId.SHURIKEN), '표창이 드랍 표에 없다');
  assert.equal(pool.length, Object.keys(WEAPONS).length - 1, '곡괭이 말고는 전부 나와야 한다');
});

test('흙벽을 뚫으면 확률적으로 무기가 나온다', () => {
  const w = combatWorld();
  // 난수를 고정해 "반드시 나오는" 경우와 "절대 안 나오는" 경우를 각각 본다.
  const always = () => 0;
  const never = () => 0.999999;

  assert.ok(rollTileLoot(w, 40, 40, Tile.SOFT_WALL, always), '확률을 통과했는데 안 나왔다');
  assert.equal(w.drops.length, 1);
  assert.equal(w.drops[0].kind, 'weapon');
  assert.ok(w.events.some((e) => e.t === 'loot'), 'loot 이벤트가 없다');

  const before = w.drops.length;
  assert.equal(rollTileLoot(w, 41, 40, Tile.SOFT_WALL, never), null);
  assert.equal(w.drops.length, before, '확률에 떨어졌는데 드롭이 생겼다');
});

test('광맥이 흙벽보다 무기가 잘 나온다', () => {
  assert.ok(LOOT.oreVeinChance > LOOT.softWallChance);
  const w = combatWorld();
  // 흙벽 확률과 광맥 확률 사이의 값으로 굴리면 광맥에서만 나와야 한다.
  const between = () => (LOOT.softWallChance + LOOT.oreVeinChance) / 2;
  assert.equal(rollTileLoot(w, 40, 40, Tile.SOFT_WALL, between), null);
  assert.ok(rollTileLoot(w, 41, 40, Tile.ORE_VEIN, between));
});

test('플레이어가 지은 벽에서는 무기가 안 나온다', () => {
  const w = combatWorld();
  assert.equal(rollTileLoot(w, 40, 40, Tile.STRUCTURE, () => 0), null);
});

test('실제로 파서 뚫으면 전리품 판정이 돈다', () => {
  // 확률이 낮아 한 번으로는 못 보므로, 여러 칸을 뚫어 통계로 확인한다.
  let found = 0;
  const TRIALS = 400;
  for (let i = 0; i < TRIALS; i++) {
    const w = combatWorld(teamMode, 1000 + i);
    const tx = 40, ty = 40;
    clearArea(w, tx, ty, 2);
    const wall = tileIndex(tx + 2, ty);
    w.tiles[wall] = Tile.SOFT_WALL;
    w.tileHp[wall] = 30;
    const p = addPlayerAt(w, 1, 0, tx, ty, WeaponId.PICKAXE);
    p.input.aim = 0;
    hold(p, Button.PRIMARY);
    run(w, teamMode, 30);
    if (w.drops.some((d) => d.kind === 'weapon')) found++;
  }
  const rate = found / TRIALS;
  // 넉넉한 구간으로 본다. 확률이 0이거나 1이 되는 회귀만 잡으면 된다.
  assert.ok(rate > 0.01, `한 번도 안 나왔다 (${found}/${TRIALS})`);
  assert.ok(rate < 0.5, `너무 자주 나온다 (${(rate * 100).toFixed(1)}%)`);
});

test('무기 드롭은 되찾을 만큼 남되, 영원하지는 않다', () => {
  // 너무 짧으면 "곡괭이 놓고 갔다가 되찾기"가 안 되고,
  // 너무 길면 맵이 무기로 뒤덮인다(실측 최대 32개).
  const secondsLeft = RESOURCE.weaponDropLifetimeTicks / TICK_HZ;
  assert.ok(secondsLeft >= 30, `${secondsLeft}초 — 되찾으러 갈 시간이 없다`);
  assert.ok(secondsLeft <= 120, `${secondsLeft}초 — 지나간 싸움의 잔해가 안 치워진다`);

  const w = combatWorld();
  clearArea(w, 40, 40, 2);
  const p = addPlayerAt(w, 1, 0, 40, 40, WeaponId.DAGGER);
  dropHeld(w, p);
  const drop = w.drops.find((d) => d.kind === 'weapon');
  assert.ok(drop.dieTick - w.tick > RESOURCE.dropLifetimeTicks * 0.5);
});

test('바닥의 무기가 상한을 넘으면 오래된 것부터 치워진다', () => {
  const w = combatWorld();
  clearArea(w, 40, 40, 2);
  for (let i = 0; i < RESOURCE.maxWeaponDrops + 8; i++) {
    dropWeapon(w, tileCenter(40), tileCenter(40), WeaponId.DAGGER);
  }
  const onGround = w.drops.filter((d) => d.kind === 'weapon');
  assert.equal(onGround.length, RESOURCE.maxWeaponDrops, '무기가 무한정 쌓인다');
  // 남은 것이 최근 것이어야 한다 — 방금 떨어뜨린 전리품이 사라지면 안 된다.
  const ids = onGround.map((d) => d.id);
  assert.equal(Math.min(...ids) > 8, true, '최근 드롭이 아니라 옛것이 남았다');
});

test('상한은 자원 드롭까지 지우지는 않는다', () => {
  const w = combatWorld();
  clearArea(w, 40, 40, 2);
  dropResource(w, tileCenter(40), tileCenter(40), 'ore', 5);
  for (let i = 0; i < RESOURCE.maxWeaponDrops + 5; i++) {
    dropWeapon(w, tileCenter(40), tileCenter(40), WeaponId.SPEAR);
  }
  assert.equal(w.drops.filter((d) => d.kind === 'ore').length, 1, '광석이 같이 지워졌다');
});

// ── 구급품 ───────────────────────────────────────────────────────────────────

test('벽을 뚫으면 확률적으로 구급품이 나온다', () => {
  const w = combatWorld();
  assert.equal(rollTileHealth(w, 40, 40, Tile.SOFT_WALL, () => 0), true);
  assert.equal(w.drops.length, 1);
  assert.equal(w.drops[0].kind, 'health');

  assert.equal(rollTileHealth(w, 41, 40, Tile.SOFT_WALL, () => 0.999999), false);
  assert.equal(w.drops.length, 1);
});

test('구급품 추첨은 무기 추첨과 독립이다', () => {
  // 하나가 나오면 다른 하나가 안 나오는 식이면, 다칠수록 파고 싶어지는
  // 흐름과 무기를 찾는 흐름이 서로를 갉아먹는다.
  const w = combatWorld();
  const always = () => 0;
  rollTileLoot(w, 40, 40, Tile.SOFT_WALL, always);
  rollTileHealth(w, 40, 40, Tile.SOFT_WALL, always);
  assert.equal(w.drops.filter((d) => d.kind === 'weapon').length, 1);
  assert.equal(w.drops.filter((d) => d.kind === 'health').length, 1);
});

test('다쳤을 때 밟으면 회복되고, 최대치를 넘지 않는다', () => {
  const w = combatWorld();
  clearArea(w, 40, 40, 2);
  const p = addPlayerAt(w, 1, 0, 40, 40);
  p.hp = 20;
  dropHealth(w, p.x, p.y, RESOURCE.healthAmount);
  run(w, teamMode, 10);

  assert.equal(p.hp, Math.min(PLAYER.maxHp, 20 + RESOURCE.healthAmount));
  // 맵 중앙의 조각 노드도 드롭을 뱉으므로 구급품만 센다.
  assert.equal(w.drops.filter((d) => d.kind === 'health').length, 0, '구급품이 안 사라졌다');
});

test('체력이 가득하면 구급품을 줍지 않고 남겨 둔다', () => {
  // 멀쩡할 때 밟고 지나갔다가 다치고 나서 되돌아오는 게 이 아이템의 요점이다.
  const w = combatWorld();
  clearArea(w, 40, 40, 2);
  const p = addPlayerAt(w, 1, 0, 40, 40);
  dropHealth(w, p.x, p.y, RESOURCE.healthAmount);
  const health = () => w.drops.filter((d) => d.kind === 'health').length;
  run(w, teamMode, 10);
  assert.equal(health(), 1, '가득 찼는데 주워서 버렸다');

  p.hp = 50;
  run(w, teamMode, 5);
  assert.equal(health(), 0, '다쳤는데도 안 줍는다');
  assert.equal(p.hp, Math.min(PLAYER.maxHp, 50 + RESOURCE.healthAmount));
});

test('구급품은 자원보다 오래 남는다', () => {
  assert.ok(RESOURCE.healthDropLifetimeTicks > RESOURCE.dropLifetimeTicks * 2);
});

test('준비 페이즈에도 사람은 때릴 수 있다', () => {
  // 조용히 무시되는 규칙 때문에 "공격이 없는 게임"으로 오해받았다.
  const w = combatWorld();
  w.phase = Phase.PREP;
  w.phaseEndTick = 1e9;
  clearArea(w, 40, 40, 4);
  const a = addPlayerAt(w, 1, 0, 40, 40, WeaponId.SPEAR);
  const foe = addPlayerAt(w, 2, 1, 41, 40);
  a.input.aim = 0;
  hold(a, Button.PRIMARY);
  run(w, teamMode, 12);
  assert.ok(foe.hp < PLAYER.maxHp, '준비 페이즈라고 피가 안 깎인다');
});

test('준비 페이즈에는 코어만 지켜진다', () => {
  // 사람은 때릴 수 있어도 승패가 준비 시간에 갈리면 안 된다.
  const w = combatWorld();
  w.phase = Phase.PREP;
  w.phaseEndTick = 1e9;
  const core = w.cores.find((c) => c.team === 1);
  const before = core.hp;
  damageTile(w, core.tx, core.ty, 500, 0);
  assert.equal(core.hp, before);
});

test('싱글 플레이의 준비 시간은 멀티보다 길지 않다', () => {
  // 혼자 하는 판에서 땅만 파며 기다리는 시간이 남들과 맞춰 기다리는 시간보다
  // 길 이유는 없다. 지금은 같지만, 따로 조절할 수 있게 남겨 둔 값이다.
  assert.ok(MATCH.prepTicksSingle <= MATCH.prepTicks);
  const solo = createWorld({ seed: 1, mode: ModeId.FFA, prepTicks: MATCH.prepTicksSingle });
  createPlayer(solo, 1, 'me', 0);
  createPlayer(solo, 2, 'bot', 1);
  startRound(solo, ffaMode);
  assert.equal(solo.phaseEndTick - solo.tick, MATCH.prepTicksSingle);
});

// ── 킬 보상 ──────────────────────────────────────────────────────────────────

test('적을 죽이면 광석과 코어 조각을 받는다', () => {
  const w = combatWorld();
  clearArea(w, 40, 40, 4);
  const killer = addPlayerAt(w, 1, 0, 40, 40, WeaponId.SPEAR);
  const victim = addPlayerAt(w, 2, 1, 41, 40, WeaponId.DAGGER);
  victim.hp = 5;
  killer.input.aim = 0;
  hold(killer, Button.PRIMARY);

  run(w, teamMode, 12);

  assert.equal(victim.alive, false);
  assert.equal(killer.res.ore, PLAYER.killRewardOre);
  assert.equal(killer.res.shard, PLAYER.killRewardShard);
  assert.ok(w.events.some((e) => e.t === 'bounty' && e.id === killer.id) ||
            killer.res.shard > 0, '보상 이벤트가 없다');
});

test('같은 편을 죽여도 보상은 없다 — 애초에 때릴 수가 없다', () => {
  const w = combatWorld();
  clearArea(w, 40, 40, 4);
  const a = addPlayerAt(w, 1, 0, 40, 40, WeaponId.SPEAR);
  const mate = addPlayerAt(w, 2, 0, 41, 40);
  a.input.aim = 0;
  hold(a, Button.PRIMARY);
  run(w, teamMode, 30);
  assert.equal(a.res.shard, 0);
});

test('코어 조각은 포탑 말고는 쓸 데가 없다 — 중앙과 킬로만 얻는다', () => {
  const needsShard = Object.values(STRUCTURES).filter((d) => d.cost.shard > 0);
  assert.deepEqual(needsShard.map((d) => d.id), ['turret']);
});

// ── 건설 ─────────────────────────────────────────────────────────────────────

test('망치로 지은 벽은 길을 막고, 아군은 문을 지난다', () => {
  const w = combatWorld();
  clearArea(w, 40, 40, 3);
  const p = addPlayerAt(w, 1, 0, 40, 40, WeaponId.HAMMER);
  p.res.ore = 200;

  assert.equal(build(w, p, 41, 40, 'wall').ok, true);
  assert.equal(getTile(w, 41, 40), Tile.STRUCTURE);
  assert.equal(circleFits(w, tileCenter(41), tileCenter(40), PLAYER.radius, 1), false, '적이 통과한다');

  assert.equal(build(w, p, 40, 41, 'door').ok, true);
  assert.equal(circleFits(w, tileCenter(40), tileCenter(41), PLAYER.radius, 0), true, '아군이 제 문을 못 지난다');
  assert.equal(circleFits(w, tileCenter(40), tileCenter(41), PLAYER.radius, 1), false, '적이 남의 문을 지난다');
});

test('포탑은 코어 조각 없이는 못 짓는다', () => {
  const w = combatWorld();
  clearArea(w, 40, 40, 3);
  const p = addPlayerAt(w, 1, 0, 40, 40, WeaponId.HAMMER);
  p.res.ore = 9999;
  p.res.shard = 0;
  assert.equal(build(w, p, 41, 40, 'turret').ok, false, '조각 없이 포탑이 섰다');

  p.res.shard = STRUCTURES.turret.cost.shard;
  assert.equal(build(w, p, 41, 40, 'turret').ok, true);
});

test('망치가 없으면 지을 수 없다', () => {
  const w = combatWorld();
  clearArea(w, 40, 40, 3);
  const p = addPlayerAt(w, 1, 0, 40, 40, WeaponId.DAGGER);
  p.res.ore = 200;
  assert.equal(build(w, p, 41, 40, 'wall').ok, false);
});

test('사람이 서 있는 칸에는 벽을 못 세운다 — 가두기 방지', () => {
  const w = combatWorld();
  clearArea(w, 40, 40, 3);
  const p = addPlayerAt(w, 1, 0, 40, 40, WeaponId.HAMMER);
  p.res.ore = 200;
  addPlayerAt(w, 2, 1, 41, 40);
  assert.equal(build(w, p, 41, 40, 'wall').ok, false);
});

test('자기 팀 벽은 빠르게 철거할 수 있다 — 자기 굴에 갇히지 않게', () => {
  const w = combatWorld();
  clearArea(w, 40, 40, 3);
  const p = addPlayerAt(w, 1, 0, 40, 40, WeaponId.HAMMER);
  p.res.ore = 200;
  build(w, p, 41, 40, 'wall');
  p.input.aim = 0;
  hold(p, Button.PRIMARY);
  run(w, teamMode, 40);
  assert.notEqual(getTile(w, 41, 40), Tile.STRUCTURE, '자기 벽을 못 부쉈다');
});

// ── 고지 ─────────────────────────────────────────────────────────────────────

/** 전투 페이즈에서 시작하고 고지 주변이 비어 있는 월드. */
const hillWorld = (mode = teamMode, seed = 77) => {
  const w = combatWorld(mode, seed);
  clearArea(w, w.outpost.tx, w.outpost.ty, 6);
  w.tiles[tileIndex(w.outpost.tx, w.outpost.ty)] = Tile.OUTPOST;
  return w;
};

const standOnHill = (w, id, team) => {
  const p = addPlayerAt(w, id, team, w.outpost.tx, w.outpost.ty);
  p.invulnUntilTick = 1e9; // 서로 때려서 죽는 변수를 없앤다
  return p;
};

test('고지는 맵 한가운데에 있고 밟고 설 수 있다', () => {
  const w = combatWorld();
  assert.equal(getTile(w, w.outpost.tx, w.outpost.ty), Tile.OUTPOST);
  assert.equal(TILES[Tile.OUTPOST].solid, false, '고지가 막혀 있으면 올라설 수가 없다');
  assert.equal(TILES[Tile.OUTPOST].mineable, false, '고지를 캐서 없앨 수 있으면 안 된다');
  assert.equal(w.outpost.owner, null);
});

test('혼자 10초를 서 있으면 점령된다', () => {
  const w = hillWorld();
  standOnHill(w, 1, 0);

  run(w, teamMode, OUTPOST.captureTicks - 2);
  assert.equal(w.outpost.owner, null, '10초도 안 됐는데 점령됐다');
  assert.ok(w.outpost.progress > 0.8, `진행도가 안 찼다: ${w.outpost.progress}`);

  run(w, teamMode, 4);
  assert.equal(w.outpost.owner, 0);
  assert.equal(w.outpost.progress, 1);
});

test('점령하면 그 자리에 포탑이 공짜로 선다', () => {
  const w = hillWorld();
  const p = standOnHill(w, 1, 0);
  p.res.ore = 0;
  p.res.shard = 0;

  run(w, teamMode, OUTPOST.captureTicks + 2);

  const idx = tileIndex(w.outpost.turretTx, w.outpost.turretTy);
  const turret = w.structures.get(idx);
  assert.ok(turret, '점령했는데 포탑이 없다');
  assert.equal(turret.type, 'turret');
  assert.equal(turret.team, 0);
  assert.equal(p.res.ore, 0, '공짜여야 하는데 자원을 가져갔다');
});

test('주인이 바뀌면 포탑도 새 주인 것으로 갈린다', () => {
  const w = hillWorld();
  const a = standOnHill(w, 1, 0);
  run(w, teamMode, OUTPOST.captureTicks + 2);
  assert.equal(w.outpost.owner, 0);

  // 0팀이 내려오고 1팀이 올라선다.
  a.alive = false;
  standOnHill(w, 2, 1);
  run(w, teamMode, OUTPOST.captureTicks + 2);

  assert.equal(w.outpost.owner, 1);
  const turret = w.structures.get(tileIndex(w.outpost.turretTx, w.outpost.turretTy));
  assert.equal(turret.team, 1, '포탑이 옛 주인 것으로 남았다');
  // 같은 칸을 쓰므로 고지 옆에 포탑이 쌓이지 않는다.
  assert.equal([...w.structures.values()].filter((st) => st.type === 'turret').length, 1);
});

test('남이 점령해 둔 곳이어도 걸리는 시간은 똑같이 10초다', () => {
  const w = hillWorld();
  const a = standOnHill(w, 1, 0);
  run(w, teamMode, OUTPOST.captureTicks + 2);
  a.alive = false;

  standOnHill(w, 2, 1);
  const start = w.tick;
  while (w.outpost.owner !== 1 && w.tick - start < OUTPOST.captureTicks * 3) {
    stepWorld(w, teamMode);
  }
  const took = w.tick - start;
  assert.ok(
    Math.abs(took - OUTPOST.captureTicks) <= 2,
    `${took}틱 걸렸다 — 규칙을 "혼자 10초" 한 문장으로 설명할 수 없게 된다`,
  );
});

test('점령한 뒤에는 자리를 떠도 시간이 계속 쌓인다', () => {
  // 서 있는 동안만 쌓으면 점령이 아니라 인질극이 된다.
  const w = hillWorld();
  const p = standOnHill(w, 1, 0);
  run(w, teamMode, OUTPOST.captureTicks + 2);
  assert.equal(w.outpost.owner, 0);

  const banked = w.holdTicks[0];
  p.x = tileCenter(w.outpost.tx) + OUTPOST.radius * 4;   // 멀리 떠난다
  run(w, teamMode, secs(5));

  assert.ok(w.holdTicks[0] > banked + secs(4), '떠났더니 시간이 안 쌓인다');
  assert.equal(w.outpost.owner, 0, '떠났다고 주인이 바뀌었다');
  assert.equal(w.outpost.progress, 1, '떠났더니 게이지가 줄었다');
});

test('적이 고지에 올라오면 그때 시계가 멈춘다', () => {
  const w = hillWorld();
  const mine = standOnHill(w, 1, 0);
  run(w, teamMode, OUTPOST.captureTicks + 2);
  mine.x = tileCenter(w.outpost.tx) + OUTPOST.radius * 4;

  standOnHill(w, 2, 1);           // 적이 발을 들인다
  const banked = w.holdTicks[0];
  run(w, teamMode, secs(3));

  assert.equal(w.holdTicks[0], banked, '적이 올라왔는데 시간이 계속 쌓인다');
});

test('두 팀이 함께 서 있으면 경합이라 아무도 못 먹는다', () => {
  const w = hillWorld();
  standOnHill(w, 1, 0);
  standOnHill(w, 2, 1);

  run(w, teamMode, OUTPOST.captureTicks * 2);

  assert.equal(w.outpost.contested, true);
  assert.equal(w.outpost.owner, null, '경합 중인데 점령됐다');
});

test('내려오면 진행도가 되돌아간다 — 막판 날치기 방지', () => {
  const w = hillWorld();
  const p = standOnHill(w, 1, 0);
  run(w, teamMode, Math.floor(OUTPOST.captureTicks * 0.6));
  const peak = w.outpost.progress;
  assert.ok(peak > 0.4);

  p.x = tileCenter(w.outpost.tx) + OUTPOST.radius * 3;
  run(w, teamMode, secs(4));
  assert.ok(w.outpost.progress < peak, '자리를 떠났는데 진행도가 그대로다');
});

test('준비 페이즈에는 점령이 안 된다', () => {
  const w = hillWorld();
  w.phase = Phase.PREP;
  w.phaseEndTick = 1e9;
  standOnHill(w, 1, 0);
  run(w, teamMode, OUTPOST.captureTicks * 2);
  assert.equal(w.outpost.owner, null);
  assert.equal(w.outpost.progress, 0);
});

test('팀전: 고지를 들고 있으면 상대 코어가 깎인다', () => {
  const w = hillWorld();
  standOnHill(w, 1, 0);
  const enemyCore = w.cores.find((c) => c.team === 1);
  const before = enemyCore.hp;

  run(w, teamMode, OUTPOST.captureTicks + secs(3));

  assert.equal(w.outpost.owner, 0);
  assert.ok(enemyCore.hp < before, '고지를 잡았는데 상대 코어가 멀쩡하다');
  assert.equal(w.cores.find((c) => c.team === 0).hp, 2000, '내 코어가 같이 깎였다');
});

test('개인전: 고지를 충분히 오래 지키면 라운드를 가져간다', () => {
  const w = createWorld({ seed: 3, mode: ModeId.FFA, spawnCount: ffaMode.spawnCount });
  for (let i = 1; i <= 2; i++) createPlayer(w, i, `p${i}`, ffaMode.assignTeam(w, i));
  startRound(w, ffaMode);
  w.phase = Phase.COMBAT;
  w.phaseEndTick = w.tick + 100_000;
  clearArea(w, w.outpost.tx, w.outpost.ty, 6);
  w.tiles[tileIndex(w.outpost.tx, w.outpost.ty)] = Tile.OUTPOST;

  const me = [...w.players.values()][0];
  me.x = tileCenter(w.outpost.tx);
  me.y = tileCenter(w.outpost.ty);
  me.invulnUntilTick = 1e9;
  [...w.players.values()][1].alive = false;

  // 라운드가 끝나는 순간 멈춘다. 계속 돌리면 정산이 끝나고 다음 라운드가
  // 시작돼 페이즈가 PREP으로 넘어가 버린다.
  const limit = OUTPOST.captureTicks + OUTPOST.holdToWinTicks + 20;
  let ticks = 0;
  while (w.phase === Phase.COMBAT && ticks < limit) { stepWorld(w, ffaMode); ticks++; }

  assert.equal(w.phase, Phase.ROUND_END, `${ticks}틱 동안 라운드가 안 끝났다`);
  assert.equal(w.score[me.team], 1);
  // 혼자 서 있는 시간은 점령을 끝내기 전부터 쌓인다. 그래서 점령 10초 + 보유
  // 75초를 따로 기다릴 필요가 없다 — 이게 개인전 교착을 푸는 규칙이다.
  assert.ok(
    ticks <= OUTPOST.holdToWinTicks + 5,
    `${ticks}틱 걸렸다 — 점령 시간이 보유 시간에 더해지고 있다`,
  );
});

test('개인전 시간 초과는 고지를 오래 지킨 쪽이 이긴다', () => {
  const w = combatWorld(ffaMode);
  w.holdTicks = { 0: 400, 1: 120 };
  assert.equal(ffaMode.onTimeUp(w).winner, 0);
  w.holdTicks = { 0: 200, 1: 200 };
  assert.equal(ffaMode.onTimeUp(w).winner, null, '동률인데 승자가 나왔다');
});

test('라운드가 새로 시작되면 고지가 중립으로 돌아간다', () => {
  const w = createWorld({ seed: 3, mode: ModeId.TEAM, spawnCount: 2 });
  createPlayer(w, 1, 'a', 0);
  createPlayer(w, 2, 'b', 1);
  startRound(w, teamMode);
  w.outpost.owner = 0;
  w.holdTicks = { 0: 500 };

  startRound(w, teamMode);
  assert.equal(w.outpost.owner, null);
  assert.deepEqual(w.holdTicks, {});
});

// ── 라운드 진행 ──────────────────────────────────────────────────────────────

test('준비 페이즈가 끝나면 봉쇄벽이 사라진다', () => {
  const w = createWorld({ seed: 3, mode: ModeId.TEAM, spawnCount: 2 });
  createPlayer(w, 1, 'a', 0);
  createPlayer(w, 2, 'b', 1);
  startRound(w, teamMode);

  assert.equal(w.phase, Phase.PREP);
  const barriers = w.barrierTiles.length;
  assert.ok(barriers > 0, '봉쇄벽이 생기지 않았다');

  run(w, teamMode, w.phaseEndTick - w.tick + 1);

  assert.equal(w.phase, Phase.COMBAT);
  assert.equal(w.tiles.filter((t) => t === Tile.BARRIER).length, 0, '봉쇄벽이 남아 있다');
});

test('코어가 부서지면 라운드가 끝나고 점수가 오른다', () => {
  const w = createWorld({ seed: 3, mode: ModeId.TEAM, spawnCount: 2 });
  createPlayer(w, 1, 'a', 0);
  createPlayer(w, 2, 'b', 1);
  startRound(w, teamMode);
  w.phase = Phase.COMBAT;
  w.phaseEndTick = w.tick + 100_000;

  w.cores.find((c) => c.team === 1).hp = 0;
  run(w, teamMode, 1);

  assert.equal(w.phase, Phase.ROUND_END);
  assert.equal(w.score[0], 1);
});

test('두 모드 모두 죽으면 부활한다 — 고지를 잡는 게 목적이므로 퇴장은 없다', () => {
  assert.equal(ffaMode.allowsRespawn(), true);
  assert.equal(teamMode.allowsRespawn(), true);
});

test('라운드가 새로 시작되면 지난 라운드의 땅굴이 사라진다', () => {
  const w = createWorld({ seed: 3, mode: ModeId.TEAM, spawnCount: 2 });
  createPlayer(w, 1, 'a', 0);
  createPlayer(w, 2, 'b', 1);
  startRound(w, teamMode);
  const before = w.tiles.slice();

  // 땅을 크게 파낸 것처럼 만든다.
  clearArea(w, 30, 30, 6);
  assert.notDeepEqual([...w.tiles], [...before]);

  startRound(w, teamMode);
  assert.equal(w.round, 2);
  assert.ok(w.tiles.some((t, i) => t !== 0 && i > 0), '새 맵이 비어 있다');
  assert.equal(w.structures.size, 0);
  assert.equal(w.drops.length, 0);
});

// ── 순위표 ───────────────────────────────────────────────────────────────────

test('순위는 라운드 승 → 점령 시간 → 킬 → 적게 죽은 순이다', () => {
  const w = combatWorld();
  const a = addPlayerAt(w, 1, 0, 40, 40);
  const b = addPlayerAt(w, 2, 1, 44, 40);
  const c = addPlayerAt(w, 3, 2, 48, 40);

  // 라운드 승이 최우선.
  w.score = { 0: 1, 1: 2, 2: 0 };
  w.holdTicks = { 0: 900, 1: 10, 2: 500 };
  assert.deepEqual(standings(w).map((s) => s.team), [1, 0, 2]);

  // 승수가 같으면 점령 시간.
  w.score = { 0: 1, 1: 1, 2: 1 };
  assert.deepEqual(standings(w).map((s) => s.team), [0, 2, 1]);

  // 점령까지 같으면 킬.
  w.holdTicks = { 0: 100, 1: 100, 2: 100 };
  b.kills = 5;
  assert.equal(standings(w)[0].team, 1);

  // 킬까지 같으면 적게 죽은 쪽.
  b.kills = 0;
  a.deaths = 3;
  c.deaths = 1;
  assert.equal(standings(w).map((s) => s.team).indexOf(0), 2, '많이 죽은 쪽이 앞에 있다');
  void b;
});

test('순위표는 팀별로 합산한다', () => {
  const w = combatWorld();
  const a = addPlayerAt(w, 1, 0, 40, 40);
  const b = addPlayerAt(w, 2, 0, 42, 40);
  addPlayerAt(w, 3, 1, 46, 40);
  a.kills = 2; a.deaths = 1;
  b.kills = 3; b.deaths = 0;

  const team0 = standings(w).find((s) => s.team === 0);
  assert.equal(team0.kills, 5, '팀원 기록이 합산되지 않았다');
  assert.equal(team0.deaths, 1);
  assert.deepEqual(team0.members.sort(), [1, 2]);
  assert.equal(team0.alive, 2);
});

test('사람이 나가도 그 팀의 라운드 승수는 표에 남는다', () => {
  // 나갔다고 점수가 사라지면 매치 점수판이 도중에 틀어진다.
  const w = combatWorld();
  w.score = { 0: 2, 1: 1 };
  assert.deepEqual(standings(w).map((s) => s.team), [0, 1]);
  assert.equal(standings(w)[0].members.length, 0);
});

test('정산 시간은 순위표를 읽을 만큼 준다', () => {
  assert.ok(MATCH.intermissionTicks >= secs(15), '순위표를 훑기에 짧다');
});

// ── 붕괴 구역 ────────────────────────────────────────────────────────────────

test('구역은 전투가 진행되며 좁아진다', () => {
  const w = combatWorld();
  w.combatTicks = MATCH.combatTicks;

  const at = (ratio) => {
    w.phaseEndTick = w.tick + Math.round(w.combatTicks * (1 - ratio));
    return zoneRadius(w);
  };

  const begin = at(0);
  const early = at(ZONE.shrinkStartRatio - 0.05);
  const mid = at((ZONE.shrinkStartRatio + ZONE.shrinkEndRatio) / 2);
  const late = at(ZONE.shrinkEndRatio + 0.05);

  assert.equal(begin, ZONE.startTiles * TILE, '시작부터 좁아져 있다');
  assert.equal(early, begin, '좁아지기 전인데 벌써 줄었다');
  assert.ok(mid < begin && mid > late, `중간값이 사이에 없다: ${mid}`);
  assert.equal(late, ZONE.endTiles * TILE, '끝나고도 계속 줄어든다');
});

test('준비 페이즈에는 구역이 좁아지지 않는다', () => {
  const w = combatWorld();
  w.phase = Phase.PREP;
  assert.equal(zoneRadius(w), ZONE.startTiles * TILE);
  assert.equal(isZoneShrinking(w), false);
});

test('구역 밖에 있으면 피가 닳고, 안에 있으면 안 닳는다', () => {
  const w = combatWorld();
  w.combatTicks = MATCH.combatTicks;
  // 다 좁아진 시점으로 보낸다.
  w.phaseEndTick = w.tick + Math.round(w.combatTicks * (1 - ZONE.shrinkEndRatio - 0.05));
  const r = zoneRadius(w);
  const c = zoneCenter();

  const inside = addPlayerAt(w, 1, 0, 40, 40);
  inside.x = c.x; inside.y = c.y;
  inside.invulnUntilTick = 0;

  const outside = addPlayerAt(w, 2, 1, 40, 40);
  outside.x = c.x + r + TILE * 4; outside.y = c.y;
  outside.invulnUntilTick = 0;

  run(w, teamMode, secs(3));

  assert.equal(inside.hp, PLAYER.maxHp, '안에 있는데 피가 닳았다');
  assert.ok(outside.hp < PLAYER.maxHp, '밖에 있는데 멀쩡하다');
  // 뛰어 돌아올 시간은 줘야 한다.
  const secondsToDie = PLAYER.maxHp / ZONE.damagePerSecond;
  assert.ok(secondsToDie > 8, `${secondsToDie.toFixed(0)}초 만에 죽는다 — 돌아올 틈이 없다`);
});

test('구역이 좁아져도 벽 속에서 부활하지 않는다', () => {
  // 구역 안으로 당긴 자리가 흙벽 한복판일 수 있다. 실제로 내구 테스트에서
  // 벽에 박힌 봇이 나와서 잡은 문제다.
  for (let seed = 1; seed <= 12; seed++) {
    const w = createWorld({ seed, mode: ModeId.TEAM, spawnCount: 2 });
    createPlayer(w, 1, 'a', 0);
    createPlayer(w, 2, 'b', 1);
    startRound(w, teamMode);
    w.phase = Phase.COMBAT;
    w.combatTicks = MATCH.combatTicks;
    // 최대로 좁아진 상태에서 부활시킨다.
    w.phaseEndTick = w.tick + 1;

    for (const p of w.players.values()) {
      respawn(w, p);
      assert.ok(
        circleFits(w, p.x, p.y, PLAYER.radius, p.team),
        `seed ${seed}: 구역이 좁아지자 벽 속에서 부활했다 (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`,
      );
    }
  }
});

test('고지 둘레에 구급품이 주기적으로 떨어진다', () => {
  const w = combatWorld();
  clearArea(w, w.outpost.tx, w.outpost.ty, 6);
  const before = w.drops.filter((d) => d.kind === 'health').length;

  run(w, teamMode, RESOURCE.outpostPotionTicks * 2 + 4);

  const potions = w.drops.filter((d) => d.kind === 'health');
  assert.ok(potions.length > before, '고지 근처에 구급품이 안 생긴다');

  // 고지 위가 아니라 둘레에 떨어져야 한다 — 주우러 가는 동안 노출되어야
  // 위험과 보상이 맞바뀐다.
  const cx = tileCenter(w.outpost.tx);
  const cy = tileCenter(w.outpost.ty);
  for (const d of potions) {
    const dist = Math.hypot(d.x - cx, d.y - cy);
    assert.ok(dist < OUTPOST.radius * 2.5, `구급품이 고지에서 ${dist.toFixed(0)}px나 떨어졌다`);
  }
});

// ── 내구 ─────────────────────────────────────────────────────────────────────

test('8인 난입 3000틱 — 터지지 않고, 아무도 벽 속에 박히지 않는다', () => {
  const w = createWorld({ seed: 99, mode: ModeId.FFA, spawnCount: ffaMode.spawnCount });
  for (let i = 1; i <= 8; i++) createPlayer(w, i, `bot${i}`, ffaMode.assignTeam(w, i));
  startRound(w, ffaMode);

  // 결정적 의사난수. 실패했을 때 그대로 재현할 수 있어야 한다.
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  for (let t = 0; t < 3000; t++) {
    for (const p of w.players.values()) {
      if (!p.alive) continue;
      if (t % 7 === 0) {
        p.input.mx = rnd() * 2 - 1;
        p.input.my = rnd() * 2 - 1;
        p.input.aim = rnd() * Math.PI * 2;
      }
      p.input.buttons = rnd() < 0.7 ? Button.PRIMARY : 0;
    }
    stepWorld(w, ffaMode);

    for (const p of w.players.values()) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `틱 ${t}: 좌표가 NaN`);
      assert.ok(
        p.x > 0 && p.y > 0 && p.x < MAP_TILES * TILE && p.y < MAP_TILES * TILE,
        `틱 ${t}: ${p.name}이 맵 밖 (${p.x}, ${p.y})`,
      );
      if (p.alive) {
        assert.ok(
          circleFits(w, p.x, p.y, PLAYER.radius - 0.5, p.team),
          `틱 ${t}: ${p.name}이 벽 속에 박혔다 (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`,
        );
      }
    }
  }
});

test('스냅샷에 실리는 이벤트와 타일 변경은 매 틱 비워진다', () => {
  const w = combatWorld();
  clearArea(w, 40, 40, 2);
  const p = addPlayerAt(w, 1, 0, 40, 40, WeaponId.PICKAXE);
  p.input.aim = 0;
  hold(p, Button.PRIMARY);
  run(w, teamMode, 30);

  const eventsA = w.events.length;
  const dirtyA = w.dirtyTiles.size;
  hold(p, 0);
  run(w, teamMode, 5);
  assert.ok(w.events.length <= eventsA, '이벤트가 누적된다');
  assert.ok(w.dirtyTiles.size <= dirtyA, '변경 타일이 누적된다');
});

test('기지마다 스폰 자리가 여럿이고, 리스폰은 적에게서 먼 자리를 고른다', () => {
  const w = combatWorld();
  const mine = w.spawns.filter((s) => s.team === 0);
  assert.ok(mine.length >= 2, '기지에 스폰 자리가 하나뿐이면 넷이 같은 픽셀에 겹쳐 나온다');

  const p = createPlayer(w, 1, 'me', 0);
  const enemy = createPlayer(w, 2, 'foe', 1);
  enemy.alive = true;
  enemy.x = mine[0].x;
  enemy.y = mine[0].y;

  respawn(w, p);
  assert.ok(
    Math.hypot(p.x - mine[0].x, p.y - mine[0].y) > 1,
    '적이 밟고 선 자리에 그대로 나왔다',
  );
});

test('라운드 시작에 팀원이 같은 자리에 겹쳐 나오지 않는다', () => {
  // 적이 아무도 안 살아 있는 라운드 시작에는 모든 자리의 점수가 같아서,
  // 늘 첫 후보만 뽑히면 팀원 전원이 한 픽셀에 포개진다.
  const w = combatWorld();
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const spot = pickSpawn(w, 0);
    seen.add(`${Math.round(spot.x)},${Math.round(spot.y)}`);
  }
  assert.ok(seen.size > 1, `40번 뽑았는데 자리가 ${seen.size}곳뿐이다`);
});

test('라운드마다 진영이 바뀔 수 있다', () => {
  // 늘 같은 쪽에서 시작하면 두 번째 라운드부터 길을 외운 쪽이 유리하다.
  const sideOf = (seed) => {
    const m = generateMap({ seed, mode: ModeId.TEAM, spawnCount: 2 });
    const zero = m.spawns.find((s) => s.team === 0);
    return zero.x > (MAP_TILES * TILE) / 2 ? 'right' : 'left';
  };
  const sides = new Set();
  for (let seed = 1; seed <= 30; seed++) sides.add(sideOf(seed));
  assert.equal(sides.size, 2, '어떤 시드에서도 0팀이 늘 같은 쪽이다');

  // 같은 시드는 같은 배치여야 한다(결정적).
  assert.equal(sideOf(7), sideOf(7));
});

test('FFA 팀 번호는 스폰 번호 범위 안에서만 배정된다', () => {
  const w = createWorld({ seed: 21, mode: ModeId.FFA, spawnCount: ffaMode.spawnCount });
  const teams = [];
  for (let i = 1; i <= 8; i++) {
    const t = ffaMode.assignTeam(w, i);
    createPlayer(w, i, `p${i}`, t);
    teams.push(t);
  }
  assert.equal(new Set(teams).size, 8, '팀 번호가 겹쳤다 — 같은 편이 되어 서로 못 때린다');
  for (const t of teams) {
    assert.ok(w.spawns.some((s) => s.team === t), `팀 ${t}에게 기지가 없다`);
  }
});
