/**
 * 서버 통합 테스트.
 *
 * 진짜 WebSocket을 열고 진짜 클라이언트처럼 붙는다. 시뮬레이션이 맞아도
 * 소켓 경로에서 깨지는 일이 흔하기 때문에, 이 층을 따로 못 박아 둔다.
 *
 * 사전 조건: `npm run build:shared && npm run build:server`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

import { Button, Phase, decodeRLE, isRoomCode, MAP_TILES, MATCH, TICK_MS } from '@gojijeon/shared';
import { RoomManager } from '../dist/room/manager.js';

// ── 테스트용 하네스 ──────────────────────────────────────────────────────────

const startServer = async () => {
  const rooms = new RoomManager();
  const http = createServer();
  const wss = new WebSocketServer({ server: http, path: '/ws' });
  wss.on('connection', (s) => rooms.attach(s));
  rooms.start();
  await new Promise((r) => http.listen(0, '127.0.0.1', r));
  const { port } = http.address();
  return {
    rooms,
    url: `ws://127.0.0.1:${port}/ws`,
    async close() {
      rooms.stop();
      // 테스트가 도중에 실패하면 소켓이 열린 채로 남는다. 그냥 http.close()를
      // 부르면 그 연결이 끝나기를 영원히 기다리며 진짜 오류를 가린다.
      for (const c of wss.clients) c.terminate();
      wss.close();
      http.closeAllConnections();
      await new Promise((r) => http.close(r));
    },
  };
};

/** 아주 얇은 클라이언트. 실제 클라가 하는 일 중 테스트에 필요한 것만 한다. */
class TestClient {
  constructor(url, name) {
    this.name = name;
    this.url = url;
    this.received = [];
    this.snapshots = [];
    this.you = null;
    this.token = null;
    this.room = null;
    this.tiles = null;
    this.seq = 0;
    this.denied = null;
    this.left = undefined;
  }

  /** `hello`는 create 또는 join 메시지. welcome이면 resolve, denied면 reject. */
  open(hello) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString('utf8'));
        this.received.push(m);
        switch (m.t) {
          case 'welcome':
            this.you = m.you;
            this.token = m.token;
            this.room = m.room;
            this.tiles = decodeRLE(m.tiles, m.mapTiles * m.mapTiles);
            resolve(this);
            break;
          case 'snapshot':
            this.snapshots.push(m.s);
            this.applyTileDelta(m.s.tileDelta);
            break;
          case 'reset':
            this.tiles = decodeRLE(m.tiles, MAP_TILES * MAP_TILES);
            break;
          case 'lobby':
            this.room = m.room;
            break;
          case 'denied':
            this.denied = m.reason;
            reject(new Error(`denied: ${m.reason}`));
            break;
          case 'left':
            this.left = m.reason;
            break;
          case 'ping':
            this.send({ t: 'pong', id: m.id });
            break;
        }
      });
      this.ws.on('open', () => this.send(hello));
    });
  }

  applyTileDelta(delta) {
    for (let i = 0; i + 2 < delta.length; i += 3) this.tiles[delta[i]] = delta[i + 1];
  }

  send(m) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  input(patch) {
    this.send({ t: 'input', seq: ++this.seq, mx: 0, my: 0, aim: 0, buttons: 0, ...patch });
  }

  get me() {
    const s = this.snapshots.at(-1);
    return s ? s.players.find((p) => p.id === this.you) : undefined;
  }

  lastOfType(t) {
    return [...this.received].reverse().find((m) => m.t === t);
  }

  close() { this.ws.close(); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 조건이 참이 될 때까지 기다린다. 틱 기반이라 고정 sleep은 불안정하다. */
const waitFor = async (predicate, { timeoutMs = 4000, label = '조건' } = {}) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = predicate();
    if (v) return v;
    await sleep(15);
  }
  throw new Error(`${label}이(가) ${timeoutMs}ms 안에 성립하지 않았다`);
};

const host = (url, name = 'host', opts = {}) =>
  new TestClient(url, name).open({
    t: 'create', name, token: null, mode: 'team', single: false, bots: 0, ...opts,
  });

const guest = (url, code, name = 'guest', token = null) =>
  new TestClient(url, name).open({ t: 'join', name, token, code });

/** 방장 + 손님이 붙어 준비 페이즈까지 들어간 상태. */
const startedMatch = async (srv) => {
  const a = await host(srv.url);
  const b = await guest(srv.url, a.room.code);
  a.send({ t: 'ready', ready: true });
  b.send({ t: 'ready', ready: true });
  await waitFor(() => a.lastOfType('lobby')?.canStart === true, { label: '시작 가능' });
  a.send({ t: 'startMatch' });
  await waitFor(() => a.me?.alive === true, { label: '스폰' });
  await waitFor(() => b.me?.alive === true, { label: '상대 스폰' });
  return { a, b };
};

// ── 방 만들기 / 입장 ─────────────────────────────────────────────────────────

test('방을 만들면 코드와 함께 맵 전체를 받는다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const a = await host(srv.url, '민수');
  assert.ok(a.you > 0);
  assert.ok(isRoomCode(a.room.code), `코드가 이상하다: ${a.room.code}`);
  assert.equal(a.room.hostId, a.you, '만든 사람이 방장이 아니다');
  assert.equal(a.room.single, false);
  assert.equal(a.tiles.length, MAP_TILES * MAP_TILES);
  assert.equal(a.tiles[0], 2, '외곽이 암반이 아니다 — 디코딩이 어긋났다');
  assert.ok(a.lastOfType('welcome').snapshot, '첫 스냅샷이 welcome에 실려야 즉시 그릴 수 있다');
  a.close();
});

test('코드를 알면 같은 방에 들어간다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const a = await host(srv.url, 'a');
  const b = await guest(srv.url, a.room.code, 'b');

  assert.equal(b.room.code, a.room.code);
  assert.equal(b.room.hostId, a.you, '들어온 사람이 방장이 되어 버렸다');
  const lobby = await waitFor(() => {
    const l = a.lastOfType('lobby');
    return l && l.players.length === 2 ? l : null;
  }, { label: '로비 2인' });
  assert.notEqual(lobby.players[0].team, lobby.players[1].team, '팀전인데 같은 팀이다');
  a.close(); b.close();
});

test('소문자·공백이 섞인 코드도 받아 준다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const a = await host(srv.url, 'a');
  const b = await guest(srv.url, ` ${a.room.code.toLowerCase()} `, 'b');
  assert.equal(b.room.code, a.room.code);
  a.close(); b.close();
});

test('없는 코드로 들어가면 사유와 함께 거절한다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const c = new TestClient(srv.url, 'x');
  await assert.rejects(() => c.open({ t: 'join', name: 'x', token: null, code: 'ZZZZ' }));
  assert.match(c.denied, /방이 없습니다/);
  c.close();
});

test('형식이 틀린 코드는 방을 뒤지기도 전에 거절한다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const c = new TestClient(srv.url, 'x');
  await assert.rejects(() => c.open({ t: 'join', name: 'x', token: null, code: 'AB' }));
  assert.match(c.denied, /4자/);
  c.close();
});

test('방마다 상태가 섞이지 않는다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const a = await host(srv.url, 'a');
  const b = await host(srv.url, 'b');
  assert.notEqual(a.room.code, b.room.code);

  await waitFor(() => a.snapshots.length > 3 && b.snapshots.length > 3, { label: '양쪽 스냅샷' });
  assert.equal(a.snapshots.at(-1).players.length, 1, '남의 방 사람이 보인다');
  assert.equal(b.snapshots.at(-1).players.length, 1, '남의 방 사람이 보인다');
  a.close(); b.close();
});

// ── 싱글 플레이 ──────────────────────────────────────────────────────────────

test('싱글 방은 봇으로 채워지고 즉시 경기가 시작된다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const a = await host(srv.url, '나', { single: true, bots: 3, mode: 'ffa' });
  assert.equal(a.room.single, true);

  const snap = await waitFor(
    () => a.snapshots.find((s) => s.phase === Phase.PREP),
    { label: '준비 페이즈 자동 시작' },
  );
  assert.equal(snap.players.length, 4, '나 + 봇 3이 아니다');
  assert.equal(snap.players.filter((p) => p.bot).length, 3);
  assert.equal(snap.players.find((p) => p.id === a.you).bot, false);
  assert.ok(snap.players.every((p) => p.alive), '경기가 시작됐는데 안 살아 있다');
  a.close();
});

test('싱글 방에는 남이 못 들어온다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const a = await host(srv.url, '나', { single: true, bots: 1 });
  const b = new TestClient(srv.url, '남');
  await assert.rejects(() => b.open({ t: 'join', name: '남', token: null, code: a.room.code }));
  assert.match(b.denied, /혼자/);
  a.close(); b.close();
});

test('봇은 실제로 맵을 돌아다닌다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const a = await host(srv.url, '나', { single: true, bots: 2, mode: 'ffa' });
  await waitFor(() => a.me?.alive === true, { label: '스폰' });

  const before = a.snapshots.at(-1).players
    .filter((p) => p.bot)
    .map((p) => ({ id: p.id, x: p.x, y: p.y }));
  await sleep(2500);
  const after = a.snapshots.at(-1).players.filter((p) => p.bot);

  const moved = before.filter((b0) => {
    const b1 = after.find((p) => p.id === b0.id);
    return b1 && Math.hypot(b1.x - b0.x, b1.y - b0.y) > 20;
  });
  assert.ok(moved.length > 0, '봇이 제자리에 서 있다');
  // 굴착까지는 여기서 요구하지 않는다. 진입로가 뚫린 뒤로 봇은 초반에 파지 않고
  // 복도를 달린다 — 그게 의도한 행동이다. 굴착 자체는 규칙 테스트가 본다.
  a.close();
});

// ── 고지 ─────────────────────────────────────────────────────────────────────

test('스냅샷에 고지 상태가 실려 온다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const a = await host(srv.url, '나', { single: true, bots: 1, mode: 'team' });
  await waitFor(() => a.snapshots.length > 3, { label: '스냅샷' });

  const o = a.snapshots.at(-1).outpost;
  assert.ok(o, '고지 정보가 없다');
  assert.equal(o.owner, null, '시작부터 주인이 있다');
  assert.equal(o.progress, 0);
  assert.ok(o.radius > 0, '점령 반경이 없으면 클라가 원을 못 그린다');
  assert.equal(o.holdToWin, 0, '팀전인데 누적 점령 승리 조건이 켜져 있다');
  a.close();
});

test('개인전에서만 누적 점령 승리 조건이 켜진다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const a = await host(srv.url, '나', { single: true, bots: 1, mode: 'ffa' });
  await waitFor(() => a.snapshots.length > 3, { label: '스냅샷' });
  assert.ok(a.snapshots.at(-1).outpost.holdToWin > 0);
  a.close();
});

test('스냅샷에 정렬된 순위표가 실려 온다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const a = await host(srv.url, '나', { single: true, bots: 3, mode: 'ffa' });
  await waitFor(() => a.snapshots.length > 3, { label: '스냅샷' });

  const snap = a.snapshots.at(-1);
  assert.equal(snap.standings.length, 4, '나 + 봇 3이 순위표에 없다');
  assert.ok(snap.roundsToWin > 0, '매치 목표 승수가 없으면 "2 / 3"을 못 그린다');
  assert.ok(snap.intermissionTicks > 0, '정산 시간이 없으면 카운트다운을 못 그린다');

  for (const row of snap.standings) {
    assert.ok(Array.isArray(row.members), 'members가 없으면 이름을 못 붙인다');
    assert.equal(typeof row.hold, 'number');
    assert.equal(typeof row.kills, 'number');
    assert.equal(typeof row.deaths, 'number');
  }
  // 나는 반드시 어느 줄엔가 속해 있어야 한다.
  assert.ok(snap.standings.some((r) => r.members.includes(a.you)), '내 줄이 없다');
  a.close();
});

test('순위표는 서버가 정렬해서 보낸다 — 클라가 다시 줄 세울 필요가 없다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const a = await host(srv.url, '나', { single: true, bots: 3, mode: 'ffa' });
  // 봇들이 고지를 두고 다투도록 충분히 둔다.
  await sleep(4000);

  const rows = a.snapshots.at(-1).standings;
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i - 1], c = rows[i];
    const ordered =
      p.score > c.score ||
      (p.score === c.score && p.hold > c.hold) ||
      (p.score === c.score && p.hold === c.hold && p.kills > c.kills) ||
      (p.score === c.score && p.hold === c.hold && p.kills === c.kills && p.deaths <= c.deaths);
    assert.ok(ordered, `${i}번째 줄이 순서를 어겼다: ${JSON.stringify([p, c])}`);
  }
  a.close();
});

// ── 방장 권한 ────────────────────────────────────────────────────────────────

test('방장이 아니면 시작도 모드 변경도 못 한다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const a = await host(srv.url, 'a');
  const b = await guest(srv.url, a.room.code, 'b');
  a.send({ t: 'ready', ready: true });
  b.send({ t: 'ready', ready: true });
  await waitFor(() => a.lastOfType('lobby')?.canStart === true, { label: '시작 가능' });

  b.send({ t: 'startMatch' });
  b.send({ t: 'setMode', mode: 'ffa' });
  b.send({ t: 'setBots', count: 5 });
  await sleep(300);

  assert.equal(a.snapshots.at(-1).phase, Phase.LOBBY, '손님이 경기를 시작시켰다');
  assert.equal(a.lastOfType('lobby').room.mode, 'team', '손님이 모드를 바꿨다');
  assert.equal(a.lastOfType('lobby').room.bots, 0, '손님이 봇을 넣었다');
  a.close(); b.close();
});

test('방장이 나가면 다음 사람이 방장이 된다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const a = await host(srv.url, 'a');
  const b = await guest(srv.url, a.room.code, 'b');
  await waitFor(() => b.lastOfType('lobby')?.players.length === 2, { label: '로비 2인' });

  a.send({ t: 'leave' });
  const lobby = await waitFor(() => {
    const l = b.lastOfType('lobby');
    return l && l.room.hostId === b.you ? l : null;
  }, { label: '방장 승계' });
  assert.equal(lobby.players.length, 1);
  b.close();
});

test('방장이 봇을 넣고 뺄 수 있고, 정원을 넘지 않는다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const a = await host(srv.url, 'a');
  a.send({ t: 'setBots', count: 3 });
  await waitFor(() => a.lastOfType('lobby')?.room.bots === 3, { label: '봇 3' });

  a.send({ t: 'setBots', count: 0 });
  await waitFor(() => a.lastOfType('lobby')?.room.bots === 0, { label: '봇 0' });

  a.send({ t: 'setBots', count: 99 });
  const l = await waitFor(() => {
    const x = a.lastOfType('lobby');
    return x && x.room.bots > 0 ? x : null;
  }, { label: '봇 채움' });
  assert.equal(l.players.length, MATCH.maxPlayers, '정원을 넘겼거나 덜 채웠다');
  a.close();
});

// ── 나가기 ───────────────────────────────────────────────────────────────────

test('나가면 left를 받고 방에서 사라진다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const a = await host(srv.url, 'a');
  const b = await guest(srv.url, a.room.code, 'b');
  await waitFor(() => a.lastOfType('lobby')?.players.length === 2, { label: '로비 2인' });

  b.send({ t: 'leave' });
  await waitFor(() => b.left !== undefined, { label: 'left 수신' });
  assert.equal(b.left, null, '스스로 나갔는데 사유가 붙었다');
  await waitFor(() => a.lastOfType('lobby')?.players.length === 1, { label: '목록에서 제거' });
  a.close(); b.close();
});

test('마지막 사람이 나가면 싱글 방은 바로 정리된다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const a = await host(srv.url, '나', { single: true, bots: 2 });
  assert.equal(srv.rooms.status.rooms, 1);
  a.send({ t: 'leave' });
  await waitFor(() => srv.rooms.status.rooms === 0, { label: '방 정리' });
  a.close();
});

// ── 경기 진행 ────────────────────────────────────────────────────────────────

test('전원이 준비하면 방장이 경기를 시작할 수 있다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const a = await host(srv.url, 'a');
  const b = await guest(srv.url, a.room.code, 'b');
  await waitFor(() => a.lastOfType('lobby')?.players.length === 2, { label: '로비 2인' });
  assert.equal(a.lastOfType('lobby').canStart, false, '아무도 준비 안 했는데 시작 가능');

  a.send({ t: 'ready', ready: true });
  b.send({ t: 'ready', ready: true });
  await waitFor(() => a.lastOfType('lobby')?.canStart === true, { label: '시작 가능' });

  a.send({ t: 'startMatch' });
  const snap = await waitFor(() => a.snapshots.find((s) => s.phase === Phase.PREP), { label: '준비 페이즈' });
  assert.equal(snap.round, 1);
  a.close(); b.close();
});

test('입력을 보내면 실제로 움직이고, ack가 따라 올라간다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const { a, b } = await startedMatch(srv);
  const start = { x: a.me.x, y: a.me.y };
  // 사방으로 밀어 본다. 기지 안이라 한 방향은 벽일 수 있다.
  for (const [mx, my] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    for (let i = 0; i < 12; i++) { a.input({ mx, my, aim: 0 }); await sleep(TICK_MS); }
    if (Math.hypot(a.me.x - start.x, a.me.y - start.y) > 4) break;
  }
  assert.ok(Math.hypot(a.me.x - start.x, a.me.y - start.y) > 4, '입력을 보냈는데 제자리다');
  assert.ok(a.snapshots.at(-1).ack > 0, 'ack가 안 올라왔다');
  a.close(); b.close();
});

test('땅을 파면 타일 델타가 오고, 클라의 맵 사본이 서버와 같아진다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const { a, b } = await startedMatch(srv);

  // 기지를 벗어난 뒤 옆을 판다.
  //
  // 스폰 방은 암반으로 둘러싸인 빈 방이라 팔 것이 하나도 없고, 진입로는
  // 이미 뚫려 있어 중앙으로 걸어도 팔 것이 없다. 실제 플레이에서 굴착이
  // 일어나는 자리는 "복도로 나와서 옆벽을 파는" 순간이므로 그걸 흉내 낸다.
  const CENTER = (MAP_TILES * 32) / 2;
  const brokenTiles = () => a.snapshots.flatMap((s) => s.events).filter((e) => e.t === 'tileBroken');

  // 1) 복도로 나간다.
  for (let i = 0; i < 60; i++) {
    const me = a.me;
    const aim = Math.atan2(CENTER - me.y, CENTER - me.x);
    a.input({ mx: Math.cos(aim), my: Math.sin(aim), aim });
    await sleep(TICK_MS);
  }

  // 2) 멈춰 서서 사방을 훑는다. 복도 양옆은 흙벽이라 반드시 닿는다.
  let sawDelta = false;
  for (let i = 0; i < 260 && brokenTiles().length === 0; i++) {
    const aim = (i / 26) * Math.PI * 2;
    a.input({ mx: 0, my: 0, aim, buttons: Button.PRIMARY });
    await sleep(TICK_MS);
    sawDelta ||= a.snapshots.at(-1).tileDelta.length > 0;
  }

  assert.ok(sawDelta, '굴착 진행이 델타로 전달되지 않았다');
  assert.ok(brokenTiles().length > 0, '한참 팠는데 벽이 하나도 안 뚫렸다');
  // 여기가 어긋나면 화면에는 벽이 있는데 통과되는 유령벽 버그가 된다.
  for (const e of brokenTiles()) {
    assert.equal(a.tiles[e.tile], 0, `타일 ${e.tile}이 클라 사본에서 안 뚫렸다`);
  }
  a.close(); b.close();
});

test('경기 도중 들어와도 바로 참여한다 — 관전으로 방치하지 않는다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  // "같은 와이파이인데 안 들어와진다"는 신고의 실체였다. 접속은 됐지만
  // 다음 라운드까지 캐릭터가 없어 5분을 떠다녔다.
  const { a, b } = await startedMatch(srv);
  await waitFor(() => a.snapshots.at(-1).phase === Phase.PREP, { label: '경기 진행 중' });

  const late = await guest(srv.url, a.room.code, '지각생');
  const me = await waitFor(
    () => late.snapshots.at(-1)?.players.find((p) => p.id === late.you),
    { label: '내 상태' },
  );

  assert.equal(me.alive, true, '들어왔는데 캐릭터가 없다');
  assert.equal(me.spectating, false, '관전 상태로 방치됐다');
  assert.ok(me.hp > 0);
  a.close(); b.close(); late.close();
});

test('새로고침으로 돌아와도 관전에 갇히지 않는다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const { a, b } = await startedMatch(srv);
  const { token, room, you } = b;
  b.close();
  await waitFor(
    () => a.snapshots.at(-1)?.players.find((p) => p.id === you)?.connected === false,
    { label: '연결 끊김 반영' },
  );

  const again = await guest(srv.url, room.code, 'b', token);
  const me = await waitFor(
    () => again.snapshots.at(-1)?.players.find((p) => p.id === you),
    { label: '복귀 상태' },
  );
  assert.equal(me.spectating, false, '돌아왔는데 관전만 하게 됐다');
  a.close(); again.close();
});

// ── 재접속과 방어 ────────────────────────────────────────────────────────────

test('끊겼다 같은 토큰으로 돌아오면 원래 슬롯을 되찾는다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const { a, b } = await startedMatch(srv);
  const originalId = a.you;
  const { token, room } = a;
  a.close();
  await waitFor(
    () => b.snapshots.at(-1)?.players.find((p) => p.id === originalId)?.connected === false,
    { label: '연결 끊김 반영' },
  );

  const again = await guest(srv.url, room.code, 'a', token);
  assert.equal(again.you, originalId, '다른 슬롯을 받았다');
  await waitFor(
    () => again.snapshots.at(-1)?.players.find((p) => p.id === originalId)?.connected === true,
    { label: '재접속 반영' },
  );
  again.close(); b.close();
});

test('스스로 나간 뒤에는 옛 토큰으로 자리를 되찾지 못한다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const a = await host(srv.url, 'a');
  const b = await guest(srv.url, a.room.code, 'b');
  const oldId = b.you;
  const oldToken = b.token;
  b.send({ t: 'leave' });
  await waitFor(() => a.lastOfType('lobby')?.players.length === 1, { label: '퇴장 반영' });

  const again = await guest(srv.url, a.room.code, 'b', oldToken);
  assert.notEqual(again.you, oldId, '나간 사람이 옛 자리를 되찾았다');
  a.close(); again.close();
});

test('정원을 넘으면 거절한다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const a = await host(srv.url, 'p0');
  const clients = [a];
  for (let i = 1; i < MATCH.maxPlayers; i++) {
    clients.push(await guest(srv.url, a.room.code, `p${i}`));
  }

  const late = new TestClient(srv.url, 'late');
  await assert.rejects(() => late.open({ t: 'join', name: 'late', token: null, code: a.room.code }));
  assert.match(late.denied, /정원/);
  for (const c of clients) c.close();
});

test('create/join 전에는 어떤 메시지도 먹히지 않는다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const ws = new WebSocket(srv.url);
  await new Promise((r) => ws.on('open', r));
  const seen = [];
  ws.on('message', (raw) => seen.push(JSON.parse(raw.toString('utf8'))));

  ws.send(JSON.stringify({ t: 'input', seq: 1, mx: 1, my: 0, aim: 0, buttons: 1 }));
  ws.send(JSON.stringify({ t: 'startMatch' }));
  ws.send(JSON.stringify({ t: 'leave' }));
  await sleep(300);

  assert.equal(seen.length, 0, '방에 들어가지도 않았는데 서버가 뭔가 보냈다');
  assert.equal(srv.rooms.status.rooms, 0, '방이 생겼다');
  ws.close();
});

test('쓰레기 메시지를 보내도 서버가 죽지 않는다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const a = await host(srv.url, 'a');
  a.ws.send('이건 JSON이 아니다');
  a.ws.send('{"broken":');
  a.ws.send(JSON.stringify({ t: 'input', seq: 'NaN', mx: 'left', my: null, aim: Infinity, buttons: 99999 }));
  a.ws.send(JSON.stringify({ t: 'action', action: null }));
  a.ws.send(JSON.stringify({ t: 'action', action: { type: 'build', tx: -5, ty: 1e9, structure: '없는건물' } }));
  a.ws.send(JSON.stringify({ t: 'setBots', count: 'many' }));
  a.ws.send(JSON.stringify({ t: '모르는메시지' }));

  const before = a.snapshots.length;
  await waitFor(() => a.snapshots.length > before + 5, { label: '스냅샷 계속 도착' });
  assert.equal(srv.rooms.status.rooms, 1);
  a.close();
});

test('로비에서 모드를 바꾸면 맵이 통째로 갈리고 사람은 남는다', async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());

  const a = await host(srv.url, 'a');
  const b = await guest(srv.url, a.room.code, 'b');
  await waitFor(() => a.lastOfType('lobby')?.players.length === 2, { label: '로비 2인' });

  a.send({ t: 'setMode', mode: 'ffa' });
  const lobby = await waitFor(() => {
    const l = a.lastOfType('lobby');
    return l?.room.mode === 'ffa' ? l : null;
  }, { label: 'FFA 전환' });

  assert.equal(lobby.players.length, 2, '모드 바꿨더니 사람이 사라졌다');
  assert.equal(new Set(lobby.players.map((p) => p.team)).size, 2, 'FFA인데 같은 팀이다');
  await waitFor(() => a.lastOfType('reset') !== undefined, { label: '지형 재전송' });
  a.close(); b.close();
});
