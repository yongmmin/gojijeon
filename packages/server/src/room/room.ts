/**
 * 방 하나 = 매치 하나.
 *
 * 서버의 유일한 권위. 클라는 "하고 싶다"만 보내고, 여기서만 상태가 바뀐다.
 * 소켓을 직접 알긴 하지만 게임 규칙은 전혀 모른다 — 규칙은 전부 @gojijeon/shared에 있다.
 *
 * 싱글 플레이도 그냥 방이다. 사람 하나에 봇 여럿인 방일 뿐이라,
 * 싱글/멀티를 가르는 분기가 이 파일에 거의 없다.
 */
import type { WebSocket } from 'ws';
import {
  MATCH, ModeId, NET, OUTPOST, Phase, TICK_MS,
  applyAction, createPlayer, createWorld, encodeRLE, encodeServer, getMode,
  isZoneShrinking, resetMatch, respawn, standings, startRound, stepWorld, zoneCenter, zoneRadius,
  type GameEvent, type GameMode, type LobbyPlayer, type NetDrop, type NetPlayer,
  type NetProjectile, type NetStructure, type Player, type PlayerAction, type PlayerId,
  type RoomInfo, type ServerMessage, type Snapshot, type World,
} from '@gojijeon/shared';
import { BotBrain, botName, driveBots } from './ai.js';

interface Client {
  id: PlayerId;
  socket: WebSocket;
  token: string;
  lastSeen: number;
  /** 서버가 마지막으로 처리한 입력 번호. 클라가 지연을 가늠하는 데 쓴다. */
  lastAck: number;
  ready: boolean;
  pingId: number;
  pingSentAt: number;
  rttMs: number;
  /** 지형 전체를 다시 보내야 하는가(첫 접속·라운드 교체). */
  needsFullMap: boolean;
}

const finite = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const clamp1 = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);

export interface RoomStatus {
  code: string;
  single: boolean;
  phase: Phase;
  round: number;
  humans: number;
  bots: number;
  tick: number;
}

export interface RoomOptions {
  code: string;
  mode: ModeId;
  single: boolean;
  seed?: number;
}

export class Room {
  readonly code: string;
  readonly single: boolean;
  /** 마지막 사람이 나간 시각. 잠깐 비어도 바로 지우지 않는다. */
  emptySince: number | null = null;

  private world: World;
  private mode: GameMode;
  private clients = new Map<PlayerId, Client>();
  private brains = new Map<PlayerId, BotBrain>();
  private hostId: PlayerId = 0;
  private nextPlayerId = 1;
  private lastRound = 0;
  /** 소켓으로 들어왔지만 아직 틱에 실리지 않은 이벤트(채팅 등). */
  private pendingEvents: GameEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private accumulator = 0;
  private lastStepAt = 0;

  constructor({ code, mode, single, seed }: RoomOptions) {
    this.code = code;
    this.single = single;
    this.mode = getMode(mode);
    this.world = createWorld({
      seed: seed ?? ((Math.random() * 0xffffffff) >>> 0),
      mode,
      spawnCount: this.mode.spawnCount,
      prepTicks: single ? MATCH.prepTicksSingle : MATCH.prepTicks,
    });
  }

  // ── 수명 ───────────────────────────────────────────────────────────────────

  start(): void {
    if (this.timer) return;
    this.lastStepAt = Date.now();
    // setInterval은 드리프트가 쌓인다. 실제 경과 시간을 누적해서 따라잡는다.
    this.timer = setInterval(() => this.pump(), Math.floor(TICK_MS / 2));
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private pump(): void {
    const now = Date.now();
    this.accumulator += now - this.lastStepAt;
    this.lastStepAt = now;
    // 한 번에 너무 많이 따라잡으면(절전에서 깨어난 직후 등) 오히려 튄다. 상한을 둔다.
    if (this.accumulator > TICK_MS * 8) this.accumulator = TICK_MS * 8;

    let stepped = false;
    while (this.accumulator >= TICK_MS) {
      this.accumulator -= TICK_MS;
      this.step();
      stepped = true;
    }
    if (stepped) this.sweepTimeouts(now);
  }

  private step(): void {
    driveBots(this.world, this.brains);
    stepWorld(this.world, this.mode);

    if (this.world.round !== this.lastRound) {
      this.lastRound = this.world.round;
      for (const c of this.clients.values()) c.needsFullMap = true;
    }

    this.broadcastSnapshot();
    this.pendingEvents.length = 0;
  }

  private sweepTimeouts(now: number): void {
    for (const c of this.clients.values()) {
      if (now - c.lastSeen > NET.timeoutMs) c.socket.terminate();
    }
  }

  private get inMatch(): boolean {
    return this.world.phase === Phase.PREP || this.world.phase === Phase.COMBAT;
  }

  get isFull(): boolean {
    return this.world.players.size >= MATCH.maxPlayers;
  }

  get humanCount(): number {
    return this.clients.size;
  }

  get botCount(): number {
    return this.brains.size;
  }

  isHost(id: PlayerId): boolean {
    return this.hostId === id;
  }

  // ── 사람 입퇴장 ────────────────────────────────────────────────────────────

  /** 새 사람을 받는다. 자리가 없으면 null. */
  addHuman(socket: WebSocket, name: string, token: string): PlayerId | null {
    if (this.isFull) return null;
    const id = this.nextPlayerId++;
    const p = createPlayer(this.world, id, name, this.mode.assignTeam(this.world, id));
    p.spectating = true;
    this.clients.set(id, this.makeClient(id, socket, token));
    if (this.hostId === 0) this.hostId = id;

    // 경기 중에 들어왔으면 **바로 참여시킨다.**
    //
    // 예전에는 다음 라운드까지 관전이었다. 그런데 한 라운드가 5분이라,
    // 링크를 받고 들어온 사람은 5분 동안 캐릭터 없이 떠다니게 된다 —
    // 실제로 "같은 와이파이인데 안 들어와진다"는 신고가 그것이었다.
    // 들어왔는데 할 게 없으면 못 들어온 것과 같다.
    //
    // 부활이 있는 모드라면 늦게 합류한 사람을 기다리게 할 이유가 없다.
    // 죽어도 8초 뒤에 다시 서는 판이므로, 지금 세워 주는 것과 다르지 않다.
    if (this.inMatch) this.joinInProgress(p);

    this.emptySince = null;
    this.sendWelcome(id);
    this.broadcastLobby();
    return id;
  }

  /**
   * 경기 도중 합류한 사람(또는 봇)을 지금 바로 판에 세운다.
   * 부활이 없는 모드라면 어쩔 수 없이 다음 라운드까지 관전이다.
   */
  private joinInProgress(p: Player): void {
    if (this.mode.allowsRespawn(this.world)) {
      respawn(this.world, p);
      return;
    }
    p.alive = false;
    p.spectating = true;
  }

  /** 끊겼던 사람이 같은 토큰으로 돌아왔다. */
  resume(socket: WebSocket, playerId: PlayerId, name: string, token: string): boolean {
    const p = this.world.players.get(playerId);
    if (!p || this.clients.has(playerId)) return false;
    p.connected = true;
    p.name = name;
    // 관전 상태로 끊겼다가 돌아온 사람도 바로 세운다. 안 그러면 새로고침
    // 한 번에 남은 라운드를 통째로 구경만 하게 된다.
    if (this.inMatch && p.spectating && !p.alive) this.joinInProgress(p);
    this.clients.set(playerId, this.makeClient(playerId, socket, token));
    if (this.hostId === 0) this.hostId = playerId;
    this.emptySince = null;
    this.sendWelcome(playerId);
    this.broadcastLobby();
    return true;
  }

  private makeClient(id: PlayerId, socket: WebSocket, token: string): Client {
    return {
      id, socket, token,
      lastSeen: Date.now(), lastAck: 0, ready: false,
      pingId: 0, pingSentAt: 0, rttMs: 0,
      needsFullMap: true,
    };
  }

  /**
   * 사람이 나간다.
   *
   * `permanent`는 "나가기 버튼을 눌렀다"는 뜻이고, 아니면 연결이 끊긴 것이다.
   * 후자는 경기 중이라면 슬롯을 남겨 둔다 — 잠깐 끊긴 사람의 자리를 남이
   * 차지하면 안 되고, 돌아왔을 때 모아 둔 자원이 그대로여야 한다.
   */
  removeHuman(id: PlayerId, permanent: boolean): void {
    const c = this.clients.get(id);
    if (!c) return;
    this.clients.delete(id);

    const p = this.world.players.get(id);
    if (p) {
      p.connected = false;
      p.input.buttons = 0;
      p.input.mx = 0;
      p.input.my = 0;
      if (permanent || !this.inMatch) this.world.players.delete(id);
    }

    if (this.hostId === id) this.hostId = this.clients.keys().next().value ?? 0;
    if (this.clients.size === 0) this.emptySince = Date.now();
    this.broadcastLobby();
  }

  /** 방이 사라질 때. 남아 있는 사람에게 사유를 알리고 소켓을 닫는다. */
  close(reason: string): void {
    for (const c of this.clients.values()) {
      this.send(c.socket, { t: 'left', reason });
      c.socket.close();
    }
    this.clients.clear();
    this.stop();
  }

  // ── 봇 ─────────────────────────────────────────────────────────────────────

  /** 봇 수를 정확히 `count`로 맞춘다. */
  setBots(count: number): void {
    const room = MATCH.maxPlayers - this.clients.size;
    const want = Math.max(0, Math.min(room, Math.floor(count)));

    while (this.brains.size > want) {
      const id = [...this.brains.keys()].pop();
      if (id === undefined) break;
      this.brains.delete(id);
      this.world.players.delete(id);
    }
    while (this.brains.size < want) {
      const id = this.nextPlayerId++;
      const p = createPlayer(
        this.world, id, botName(this.brains.size), this.mode.assignTeam(this.world, id), true,
      );
      p.spectating = true;
      this.brains.set(id, new BotBrain(id));
      if (this.inMatch) this.joinInProgress(p);
    }
    this.broadcastLobby();
  }

  // ── 메시지 처리 ────────────────────────────────────────────────────────────

  handle(id: PlayerId, m: { t: string } & Record<string, unknown>): void {
    const c = this.clients.get(id);
    const p = this.world.players.get(id);
    if (!c || !p) return;
    c.lastSeen = Date.now();

    switch (m.t) {
      case 'input': {
        const seq = finite(m.seq);
        // 순서가 뒤집힌 오래된 입력은 버린다. 재접속 직후 이전 연결의 잔여
        // 입력이 섞일 수 있다.
        if (seq < c.lastAck) return;
        c.lastAck = seq;
        p.input.seq = seq;
        p.input.mx = clamp1(finite(m.mx));
        p.input.my = clamp1(finite(m.my));
        p.input.aim = finite(m.aim);
        p.input.buttons = finite(m.buttons) & 0xff;
        return;
      }

      case 'action': {
        const a = m.action as PlayerAction | undefined;
        if (!a || typeof a !== 'object' || typeof a.type !== 'string') return;
        if (!this.inMatch) return;
        applyAction(this.world, p, a);
        return;
      }

      case 'ready': {
        c.ready = m.ready === true;
        this.broadcastLobby();
        return;
      }

      case 'setMode': {
        if (!this.isHost(id) || this.world.phase !== Phase.LOBBY) return;
        const next = m.mode;
        if (next !== ModeId.FFA && next !== ModeId.TEAM) return;
        this.changeMode(next);
        return;
      }

      case 'setBots': {
        if (!this.isHost(id) || this.world.phase !== Phase.LOBBY) return;
        this.setBots(finite(m.count));
        return;
      }

      case 'startMatch': {
        if (!this.isHost(id) || this.world.phase !== Phase.LOBBY) return;
        if (!this.canStart()) return;
        this.beginMatch();
        return;
      }

      case 'chat': {
        const text = typeof m.text === 'string' ? m.text.slice(0, 160).trim() : '';
        if (text) this.pendingEvents.push({ t: 'chat', id, text });
        return;
      }

      case 'pong': {
        if (finite(m.id, -1) === c.pingId) c.rttMs = Date.now() - c.pingSentAt;
        return;
      }
    }
  }

  beginMatch(): void {
    startRound(this.world, this.mode);
    this.lastRound = this.world.round;
    for (const c of this.clients.values()) c.needsFullMap = true;
  }

  private canStart(): boolean {
    if (this.world.players.size < MATCH.minPlayers) return false;
    // 싱글에는 기다릴 상대가 없다. 준비 버튼을 만들지 않으므로 여기서도 묻지 않는다
    // (매치가 끝나고 로비로 돌아왔을 때 "한 판 더"가 바로 눌리려면 이게 필요하다).
    if (this.single) return true;
    // 봇은 늘 준비 상태다. 사람만 기다린다.
    return [...this.clients.values()].every((c) => c.ready);
  }

  /**
   * 모드가 바뀌면 맵 구조(스폰 수·코어 유무)가 통째로 달라진다.
   * 월드를 새로 만들고 사람과 봇만 옮겨 태운다.
   */
  private changeMode(modeId: ModeId): void {
    const humans = [...this.clients.keys()].map((id) => ({
      id, name: this.world.players.get(id)?.name ?? '이름없음',
    }));
    const bots = this.brains.size;

    this.mode = getMode(modeId);
    this.world = createWorld({
      seed: (Math.random() * 0xffffffff) >>> 0,
      mode: modeId,
      spawnCount: this.mode.spawnCount,
      prepTicks: this.single ? MATCH.prepTicksSingle : MATCH.prepTicks,
    });
    this.brains.clear();

    for (const { id, name } of humans) {
      const p = createPlayer(this.world, id, name, this.mode.assignTeam(this.world, id));
      p.connected = true;
      p.spectating = true;
    }
    resetMatch(this.world);
    this.lastRound = 0;
    this.setBots(bots);
    for (const c of this.clients.values()) c.needsFullMap = true;
    this.broadcastLobby();
  }

  // ── 송신 ───────────────────────────────────────────────────────────────────

  private send(socket: WebSocket, m: ServerMessage): void {
    if (socket.readyState !== 1) return;
    socket.send(encodeServer(m));
  }

  private roomInfo(): RoomInfo {
    return {
      code: this.code,
      single: this.single,
      mode: this.world.mode,
      hostId: this.hostId,
      capacity: MATCH.maxPlayers,
      bots: this.brains.size,
    };
  }

  private sendWelcome(id: PlayerId): void {
    const c = this.clients.get(id);
    if (!c) return;
    c.needsFullMap = false;
    this.send(c.socket, {
      t: 'welcome',
      you: id,
      token: c.token,
      room: this.roomInfo(),
      seed: this.world.seed,
      mapTiles: 128,
      tileSize: 32,
      tiles: encodeRLE(this.world.tiles),
      structures: this.allStructures(),
      snapshot: this.buildSnapshot([], [], c.lastAck),
    });
  }

  private allStructures(): NetStructure[] {
    return [...this.world.structures.values()].map((s) => ({
      tile: s.tile, type: s.type, team: s.team, hp: s.hp, maxHp: s.maxHp,
    }));
  }

  private broadcastLobby(): void {
    const players: LobbyPlayer[] = [...this.world.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      ready: p.bot ? true : (this.clients.get(p.id)?.ready ?? false),
      connected: p.connected,
      bot: p.bot,
    }));
    const msg: ServerMessage = {
      t: 'lobby', room: this.roomInfo(), players, canStart: this.canStart(),
    };
    for (const c of this.clients.values()) this.send(c.socket, msg);
  }

  private broadcastSnapshot(): void {
    const w = this.world;

    // 이번 틱에 생기거나 사라진 건축물만 추려 보낸다.
    // 전부 매 틱 보내면 벽 200개짜리 후반부에서 대역폭이 무너진다.
    const structAdd: NetStructure[] = [];
    const structRemove: number[] = [];
    for (const e of w.events) {
      if (e.t === 'build') {
        const s = w.structures.get(e.tile);
        if (s) structAdd.push({ tile: s.tile, type: s.type, team: s.team, hp: s.hp, maxHp: s.maxHp });
      } else if (e.t === 'structureDown') {
        structRemove.push(e.tile);
      }
    }

    const tileDelta: number[] = [];
    for (const idx of w.dirtyTiles) tileDelta.push(idx, w.tiles[idx], w.tileHp[idx]);

    const events = this.pendingEvents.length > 0 ? [...w.events, ...this.pendingEvents] : w.events;

    for (const c of this.clients.values()) {
      if (c.needsFullMap) {
        c.needsFullMap = false;
        this.send(c.socket, {
          t: 'reset',
          round: w.round,
          tiles: encodeRLE(w.tiles),
          structures: this.allStructures(),
        });
      }
      this.send(c.socket, {
        t: 'snapshot',
        s: this.buildSnapshot(tileDelta, events, c.lastAck, structAdd, structRemove),
      });
    }

    // RTT는 2초에 한 번만 잰다. 매 틱 핑을 던질 이유가 없다.
    if (w.tick % 40 === 0) {
      const now = Date.now();
      for (const c of this.clients.values()) {
        c.pingId = (c.pingId + 1) & 0xffff;
        c.pingSentAt = now;
        this.send(c.socket, { t: 'ping', id: c.pingId });
      }
    }
  }

  private buildSnapshot(
    tileDelta: number[],
    events: GameEvent[],
    ack: number,
    structAdd: NetStructure[] = [],
    structRemove: number[] = [],
  ): Snapshot {
    const w = this.world;

    const players: NetPlayer[] = [];
    for (const p of w.players.values()) {
      players.push({
        id: p.id, name: p.name, team: p.team,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        aim: Math.round(p.aim * 100) / 100,
        hp: p.hp, alive: p.alive, weapon: p.weapon,
        swing: p.swingHitTick > 0 ? p.swingHitTick - w.tick : 0,
        ore: p.res.ore, shard: p.res.shard,
        kills: p.kills, deaths: p.deaths,
        connected: p.connected, spectating: p.spectating,
        mining: p.miningTile,
        respawnIn: !p.alive && p.respawnTick > w.tick ? p.respawnTick - w.tick : 0,
        bot: p.bot,
      });
    }

    const projectiles: NetProjectile[] = w.projectiles.map((pr) => ({
      id: pr.id,
      x: Math.round(pr.x * 10) / 10,
      y: Math.round(pr.y * 10) / 10,
      vx: Math.round(pr.vx), vy: Math.round(pr.vy),
      r: pr.radius, team: pr.team, weapon: pr.weapon,
    }));

    const drops: NetDrop[] = w.drops.map((d) => ({
      id: d.id, kind: d.kind, weapon: d.weapon, amount: d.amount,
      x: Math.round(d.x), y: Math.round(d.y),
    }));

    return {
      tick: w.tick,
      phase: w.phase,
      phaseEndTick: w.phaseEndTick,
      round: w.round,
      score: Object.fromEntries(Object.entries(w.score)),
      players,
      projectiles,
      drops,
      cores: w.cores.map((c) => ({ team: c.team, tx: c.tx, ty: c.ty, hp: c.hp, maxHp: c.maxHp })),
      zone: {
        ...zoneCenter(),
        radius: Math.round(zoneRadius(w)),
        shrinking: isZoneShrinking(w),
      },
      standings: standings(w),
      roundsToWin: MATCH.roundsToWin,
      intermissionTicks: MATCH.intermissionTicks,
      outpost: {
        tx: w.outpost.tx,
        ty: w.outpost.ty,
        owner: w.outpost.owner,
        capturing: w.outpost.capturing,
        progress: Math.round(w.outpost.progress * 1000) / 1000,
        contested: w.outpost.contested,
        radius: OUTPOST.radius,
        hold: Object.fromEntries(Object.entries(w.holdTicks)),
        // 개인전에서만 승리 조건이다. 팀전에서는 0을 보내 클라가 막대를 안 그리게 한다.
        holdToWin: this.mode.id === ModeId.FFA ? OUTPOST.holdToWinTicks : 0,
      },
      tileDelta,
      structAdd,
      structRemove,
      events,
      ack,
    };
  }

  // ── 상태 조회(운영용) ──────────────────────────────────────────────────────

  get status(): RoomStatus {
    return {
      code: this.code,
      single: this.single,
      phase: this.world.phase,
      round: this.world.round,
      humans: this.clients.size,
      bots: this.brains.size,
      tick: this.world.tick,
    };
  }
}
