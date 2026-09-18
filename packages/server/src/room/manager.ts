/**
 * 방 목록과 소켓의 생애.
 *
 * 소켓은 붙자마자 어떤 방에도 속하지 않는다. `create`나 `join`이 와야 비로소
 * 방에 묶인다. 그 전까지는 아무 일도 하지 않는다 — 코드를 모르는 연결이
 * 남의 방 상태를 한 글자도 볼 수 없게 하는 가장 단순한 방법이다.
 */
import type { WebSocket } from 'ws';
import {
  MATCH, ModeId, NET,
  ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH,
  encodeServer, isRoomCode, normalizeRoomCode,
  type PlayerId,
} from '@gojijeon/shared';
import { Room, type RoomStatus } from './room.js';

/** 사람이 없는 방을 이만큼 두고 지운다. 새로고침으로 잠깐 빈 방을 살려 둔다. */
const EMPTY_ROOM_GRACE_MS = 90_000;
const SWEEP_INTERVAL_MS = 15_000;

const MAX_NAME = 14;

const sanitizeName = (raw: unknown): string => {
  const s = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  const clean = [...s]
    .filter((c) => c.codePointAt(0)! > 0x1f && c.codePointAt(0)! !== 0x7f)
    .join('')
    .slice(0, MAX_NAME);
  return clean.length > 0 ? clean : '이름없음';
};

const newToken = (): string =>
  Math.random().toString(36).slice(2) + Date.now().toString(36);

interface Session {
  code: string;
  playerId: PlayerId;
  expiresAt: number;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private sessions = new Map<string, Session>();
  private sweeper: NodeJS.Timeout | null = null;

  start(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
  }

  stop(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    for (const room of this.rooms.values()) room.stop();
    this.rooms.clear();
  }

  get status(): { rooms: number; detail: RoomStatus[] } {
    return { rooms: this.rooms.size, detail: [...this.rooms.values()].map((r) => r.status) };
  }

  // ── 소켓 ───────────────────────────────────────────────────────────────────

  attach(socket: WebSocket): void {
    /** 이 소켓이 묶인 방과 자리. create/join 전에는 null. */
    let bound: { room: Room; id: PlayerId } | null = null;

    socket.on('message', (raw) => {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { return; }
      if (!parsed || typeof parsed !== 'object') return;
      const m = parsed as { t?: unknown } & Record<string, unknown>;
      if (typeof m.t !== 'string') return;

      if (m.t === 'create') {
        if (bound) return;
        bound = this.create(socket, m);
        return;
      }
      if (m.t === 'join') {
        if (bound) return;
        bound = this.join(socket, m);
        return;
      }
      if (!bound) return;

      if (m.t === 'leave') {
        this.part(socket, bound, true);
        bound = null;
        return;
      }
      bound.room.handle(bound.id, m as { t: string } & Record<string, unknown>);
    });

    const dropped = (): void => {
      if (!bound) return;
      this.part(socket, bound, false);
      bound = null;
    };
    socket.on('close', dropped);
    socket.on('error', dropped);
  }

  private part(socket: WebSocket, bound: { room: Room; id: PlayerId }, permanent: boolean): void {
    bound.room.removeHuman(bound.id, permanent);

    if (permanent) {
      // 스스로 나갔으므로 자리를 잡아 둘 이유가 없다. 토큰도 함께 버린다.
      for (const [token, s] of this.sessions) {
        if (s.code === bound.room.code && s.playerId === bound.id) this.sessions.delete(token);
      }
      if (socket.readyState === 1) socket.send(encodeServer({ t: 'left', reason: null }));
    }

    if (bound.room.humanCount === 0 && bound.room.single) {
      // 싱글 방은 되돌아올 이유가 없다. 봇만 남겨 두고 CPU를 태울 필요는 더더욱 없다.
      this.destroy(bound.room.code);
    }
  }

  // ── create / join ──────────────────────────────────────────────────────────

  private create(socket: WebSocket, m: Record<string, unknown>): { room: Room; id: PlayerId } | null {
    const mode = m.mode === ModeId.FFA ? ModeId.FFA : ModeId.TEAM;
    const single = m.single === true;
    const code = this.freshCode();
    const room = new Room({ code, mode, single });
    this.rooms.set(code, room);
    room.start();

    const token = newToken();
    const id = room.addHuman(socket, sanitizeName(m.name), token);
    if (id === null) {
      this.destroy(code);
      this.deny(socket, '방을 만들지 못했습니다');
      return null;
    }
    this.sessions.set(token, { code, playerId: id, expiresAt: Date.now() + NET.reconnectGraceMs });

    const asked = typeof m.bots === 'number' && Number.isFinite(m.bots) ? Math.floor(m.bots) : 0;
    // 싱글인데 봇이 없으면 상대가 없어 라운드가 영원히 안 끝난다. 최소 하나는 넣는다.
    const bots = single ? Math.max(1, asked) : Math.max(0, asked);
    if (bots > 0) room.setBots(bots);

    // 싱글은 로비에서 기다릴 이유가 없다. 메뉴에서 이미 "시작"을 누르고 온 것이다.
    if (single) room.beginMatch();

    return { room, id };
  }

  private join(socket: WebSocket, m: Record<string, unknown>): { room: Room; id: PlayerId } | null {
    const code = normalizeRoomCode(typeof m.code === 'string' ? m.code : '');
    if (!isRoomCode(code)) {
      this.deny(socket, '코드는 4자입니다');
      return null;
    }
    const room = this.rooms.get(code);
    if (!room) {
      this.deny(socket, `${code} 방이 없습니다`);
      return null;
    }
    if (room.single) {
      // 싱글 방에 남이 끼어들면 "나 빼고 전부 컴퓨터"라는 약속이 깨진다.
      this.deny(socket, '혼자 하는 방입니다');
      return null;
    }

    const name = sanitizeName(m.name);
    const token = typeof m.token === 'string' ? m.token : null;

    // 1. 재접속: 토큰이 이 방의 것이고 그 자리가 비어 있으면 그대로 복귀한다.
    const session = token ? this.sessions.get(token) : undefined;
    if (token && session && session.code === code && room.resume(socket, session.playerId, name, token)) {
      session.expiresAt = Date.now() + NET.reconnectGraceMs;
      return { room, id: session.playerId };
    }

    // 2. 신규.
    const fresh = newToken();
    const id = room.addHuman(socket, name, fresh);
    if (id === null) {
      this.deny(socket, `정원이 찼습니다 (${MATCH.maxPlayers}명)`);
      return null;
    }
    this.sessions.set(fresh, { code, playerId: id, expiresAt: Date.now() + NET.reconnectGraceMs });
    return { room, id };
  }

  private deny(socket: WebSocket, reason: string): void {
    if (socket.readyState === 1) socket.send(encodeServer({ t: 'denied', reason }));
  }

  // ── 코드와 청소 ────────────────────────────────────────────────────────────

  private freshCode(): string {
    for (let attempt = 0; attempt < 500; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    // 31^4 ≈ 92만 가지라 여기까지 올 일은 사실상 없지만, 무한 루프만은 만들지 않는다.
    throw new Error('빈 방 코드를 찾지 못했습니다');
  }

  private destroy(code: string, reason = '방이 닫혔습니다'): void {
    const room = this.rooms.get(code);
    if (!room) return;
    room.close(reason);
    this.rooms.delete(code);
    for (const [token, s] of this.sessions) {
      if (s.code === code) this.sessions.delete(token);
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [token, s] of this.sessions) {
      if (s.expiresAt < now) this.sessions.delete(token);
    }
    for (const [code, room] of this.rooms) {
      if (room.humanCount > 0) continue;
      if (room.emptySince === null) { room.emptySince = now; continue; }
      if (now - room.emptySince > EMPTY_ROOM_GRACE_MS) this.destroy(code, '방이 비어 닫혔습니다');
    }
  }
}
