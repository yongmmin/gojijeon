/**
 * 서버 메시지를 그대로 반영해 두는 클라 쪽 거울.
 *
 * 여기에는 어떤 게임 로직도 없다. 서버가 보낸 것을 받아 적기만 한다.
 * 렌더러와 HUD는 전부 이 객체 하나만 읽는다.
 */
import {
  MAP_TILES, TILES, Tile, decodeRLE, tileIndex,
  type GameEvent, type LobbyPlayer, type ModeId, type NetPlayer, type NetStructure,
  type PlayerId, type RoomInfo, type ServerMessage, type Snapshot, type TileId,
} from '@gojijeon/shared';

/** 화면에 아직 반영되지 않은 이벤트가 이만큼 쌓이면 오래된 것부터 버린다(로비에 오래 머문 경우). */
const MAX_PENDING_EVENTS = 256;

export class ClientWorld {
  youId: PlayerId = -1;
  seed = 0;
  mode: ModeId = 'ffa';
  mapTiles = MAP_TILES;

  tiles: Uint8Array = new Uint8Array(MAP_TILES * MAP_TILES);
  tileHp: Uint16Array = new Uint16Array(MAP_TILES * MAP_TILES);
  structures = new Map<number, NetStructure>();

  snapshot: Snapshot | null = null;
  /** 방 정보. welcome과 lobby가 같이 실어 보낸다. 방 밖이면 null. */
  room: RoomInfo | null = null;
  lobby: { players: LobbyPlayer[]; canStart: boolean } | null = null;

  /** 지금 내가 이 방의 호스트인가. 호스트 전용 버튼은 전부 이 값으로 가린다. */
  get isHost(): boolean {
    return this.room !== null && this.room.hostId === this.youId;
  }

  /** 싱글이면 봇 이름을 흐리게 그리는 등 표시 규칙이 달라진다. */
  get isSingle(): boolean {
    return this.room !== null && this.room.single;
  }

  /** 지형이 통째로 갈린 횟수. 렌더러는 이 값이 바뀌면 캐시를 버리고 다시 그린다. */
  mapEpoch = 0;
  /** 마지막 스냅샷에서 바뀐 타일 인덱스. 렌더러들이 소비한 뒤 scene이 비운다. */
  readonly dirty = new Set<number>();
  /**
   * 그 칸이 **직전에 무엇이었는가**. 서버는 봉쇄벽이 걷히는 것을 tileBroken으로
   * 보내지 않으므로, 전투 시작 연출은 이 기록에서 사라진 봉쇄벽을 찾는다.
   * dirty와 같은 시점에 비운다.
   */
  readonly tileWas = new Map<number, TileId>();
  /** 아직 이펙트로 소비되지 않은 이벤트. */
  readonly pendingEvents: GameEvent[] = [];

  /** 서버가 처음 맞이할 때. 지형과 건축물이 통째로 온다. */
  applyWelcome(m: Extract<ServerMessage, { t: 'welcome' }>): void {
    this.youId = m.you;
    this.seed = m.seed;
    this.room = m.room;
    this.mode = m.room.mode;
    this.mapTiles = m.mapTiles;
    this.loadTiles(m.tiles, m.structures);
    this.applySnapshot(m.snapshot);
  }

  /** 라운드가 새로 시작돼 지형이 갈렸을 때. */
  applyReset(m: Extract<ServerMessage, { t: 'reset' }>): void {
    this.loadTiles(m.tiles, m.structures);
    this.pendingEvents.length = 0;
  }

  applySnapshot(s: Snapshot): void {
    this.snapshot = s;

    for (let i = 0; i + 2 < s.tileDelta.length; i += 3) {
      const idx = s.tileDelta[i];
      if (idx < 0 || idx >= this.tiles.length) continue;
      const before = this.tiles[idx] as TileId;
      if (before !== s.tileDelta[i + 1]) this.tileWas.set(idx, before);
      this.tiles[idx] = s.tileDelta[i + 1];
      this.tileHp[idx] = Math.max(0, s.tileDelta[i + 2]);
      this.dirty.add(idx);
    }

    for (const st of s.structAdd) {
      this.structures.set(st.tile, st);
      this.dirty.add(st.tile);
    }
    for (const tile of s.structRemove) {
      this.structures.delete(tile);
      this.dirty.add(tile);
    }

    for (const ev of s.events) this.pendingEvents.push(ev);
    if (this.pendingEvents.length > MAX_PENDING_EVENTS) {
      this.pendingEvents.splice(0, this.pendingEvents.length - MAX_PENDING_EVENTS);
    }
  }

  applyLobby(m: Extract<ServerMessage, { t: 'lobby' }>): void {
    this.room = m.room;
    this.lobby = { players: m.players, canStart: m.canStart };
    this.mode = m.room.mode;
  }

  /**
   * 방을 떠났다. 남은 상태를 그대로 두면 메뉴 뒤로 죽은 맵이 계속 비치고,
   * 다음 방에 들어갈 때 이전 판의 스냅샷으로 한 프레임 깜빡인다.
   */
  reset(): void {
    this.youId = -1;
    this.room = null;
    this.lobby = null;
    this.snapshot = null;
    this.structures.clear();
    this.pendingEvents.length = 0;
    this.dirty.clear();
    this.tileWas.clear();
  }

  get me(): NetPlayer | null {
    if (!this.snapshot) return null;
    return this.snapshot.players.find((p) => p.id === this.youId) ?? null;
  }

  tileAt(tx: number, ty: number): TileId {
    if (tx < 0 || ty < 0 || tx >= this.mapTiles || ty >= this.mapTiles) return Tile.HARD_WALL;
    return this.tiles[tileIndex(tx, ty)] as TileId;
  }

  drainEvents(): GameEvent[] {
    if (this.pendingEvents.length === 0) return [];
    return this.pendingEvents.splice(0, this.pendingEvents.length);
  }

  private loadTiles(b64: string, structures: NetStructure[]): void {
    const len = this.mapTiles * this.mapTiles;
    this.tiles = decodeRLE(b64, len);
    // 통째로 받은 지형은 아직 아무도 파지 않은 상태다 — hp는 타일 정의의 최대치에서 시작한다.
    this.tileHp = new Uint16Array(len);
    for (let i = 0; i < len; i++) this.tileHp[i] = TILES[this.tiles[i] as TileId].hp;

    this.structures.clear();
    for (const st of structures) {
      this.structures.set(st.tile, st);
      this.tileHp[st.tile] = st.hp;
    }

    this.dirty.clear();
    this.tileWas.clear();
    this.mapEpoch++;
  }
}
