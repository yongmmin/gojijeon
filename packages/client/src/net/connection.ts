/**
 * 서버와의 유일한 통로.
 *
 * 서버가 권위를 가지므로 클라가 보내는 것은 "입력"과 "하고 싶은 행동"뿐이다.
 * 예측/리컨실리에이션은 없다(LAN RTT 1~3ms에서는 복잡도만 늘린다).
 */
import {
  decodeServer, encodeClient, type ClientMessage, type ModeId, type ServerMessage,
} from '@gojijeon/shared';
import { clearRoom, loadToken, saveRoomCode, saveToken } from './session';

export type ConnStatus = 'connecting' | 'open' | 'closed';

/** 방에 들어가는 방법은 둘뿐이다. 재접속 때 그대로 다시 보낼 수 있게 통째로 들고 있는다. */
type RoomIntent =
  | { kind: 'create'; name: string; mode: ModeId; single: boolean; bots: number }
  | { kind: 'join'; name: string; code: string };

export interface InputFrame {
  mx: number;
  my: number;
  aim: number;
  buttons: number;
}

export interface ConnectionHandlers {
  onMessage: (m: ServerMessage) => void;
  /** attempt는 지금까지 실패한 횟수. 0이면 첫 시도. */
  onStatus: (status: ConnStatus, attempt: number) => void;
  onRtt: (rttMs: number) => void;
}

/** 입력 전송 주기: 30Hz. 다만 값이 그대로면 최소 5Hz(keepalive)로만 보낸다. */
const SEND_INTERVAL_MS = 1000 / 30;
const KEEPALIVE_MS = 1000 / 5;
const BACKOFF_START_MS = 250;
const BACKOFF_MAX_MS = 5000;
/**
 * 연결이 열리지도 닫히지도 않은 채 매달려 있을 수 있다(프록시가 업그레이드를 물고 있는 경우).
 * 그대로 두면 "연결 중…"에서 영원히 멈추므로 직접 끊고 재시도 흐름에 태운다.
 */
const CONNECT_TIMEOUT_MS = 6000;

const socketUrl = (): string => `${location.origin.replace(/^http/, 'ws')}/ws`;

export class Connection {
  private ws: WebSocket | null = null;
  private status: ConnStatus = 'closed';
  private attempt = 0;
  private backoff = BACKOFF_START_MS;
  private retryTimer = 0;
  private connectTimer = 0;
  private closedByUs = false;

  /** 메뉴에서 방을 고르기 전에는 아무것도 보내지 않는다. null이면 "방 밖". */
  private intent: RoomIntent | null = null;

  private seq = 1;
  private lastSent: InputFrame = { mx: 0, my: 0, aim: 0, buttons: 0 };
  private lastSentAt = 0;
  private everSentInput = false;
  /** seq → 보낸 시각. 스냅샷의 ack가 돌아오면 그 차이가 곧 왕복 시간이다. */
  private readonly sentAt = new Map<number, number>();
  private rtt = 0;

  constructor(private readonly handlers: ConnectionHandlers) {}

  get currentStatus(): ConnStatus {
    return this.status;
  }

  get failedAttempts(): number {
    return this.attempt;
  }

  get rttMs(): number {
    return this.rtt;
  }

  connect(): void {
    this.closedByUs = false;
    this.open();
  }

  /** 지금 방에 들어가 있거나, 들어가려고 시도하는 중인가. */
  get inRoom(): boolean {
    return this.intent !== null;
  }

  /** 새 방을 연다. 보낸 사람이 호스트가 된다. */
  createRoom(opts: { name: string; mode: ModeId; single: boolean; bots: number }): void {
    this.intent = { kind: 'create', ...opts };
    this.sendIntent();
  }

  /** 코드로 기존 방에 들어간다. 저장된 토큰이 그 방 것이면 원래 자리로 복귀한다. */
  joinRoom(opts: { name: string; code: string }): void {
    this.intent = { kind: 'join', ...opts };
    this.sendIntent();
  }

  /**
   * welcome을 받은 뒤의 재접속은 "방 만들기"가 아니라 "그 방으로 다시 들어가기"여야 한다.
   * 그대로 두면 끊길 때마다 빈 방이 하나씩 늘어난다.
   */
  private adoptRoom(code: string): void {
    const name = this.intent ? this.intent.name : '';
    this.intent = { kind: 'join', name, code };
  }

  /** 방을 떠난다. 서버의 'left'를 기다리되, 재접속 의도는 즉시 버린다. */
  leaveRoom(): void {
    this.send({ t: 'leave' });
    this.forgetRoom();
  }

  /** 방과의 인연을 끊는다(나가기·거부·해산 공통). */
  private forgetRoom(): void {
    this.intent = null;
    clearRoom();
  }

  send(m: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(encodeClient(m));
  }

  /**
   * 매 프레임 호출한다. 실제 전송 여부는 여기서 판단한다.
   * 같은 입력을 30Hz로 반복해 보내는 것은 대역폭 낭비일 뿐 아니라 서버 로그도 더럽힌다.
   */
  pumpInput(frame: InputFrame, nowMs: number): void {
    if (!this.intent || this.status !== 'open') return;
    const since = nowMs - this.lastSentAt;
    if (since < SEND_INTERVAL_MS) return;

    const changed =
      !this.everSentInput ||
      frame.mx !== this.lastSent.mx ||
      frame.my !== this.lastSent.my ||
      frame.buttons !== this.lastSent.buttons ||
      Math.abs(frame.aim - this.lastSent.aim) > 0.004;
    if (!changed && since < KEEPALIVE_MS) return;

    const seq = this.seq++;
    this.sentAt.set(seq, nowMs);
    // 오래된 항목은 ack가 영영 안 올 수 있다. 버퍼가 무한히 자라지 않게 잘라낸다.
    if (this.sentAt.size > 128) {
      const oldest = this.sentAt.keys().next();
      if (!oldest.done) this.sentAt.delete(oldest.value);
    }
    this.lastSent = { ...frame };
    this.lastSentAt = nowMs;
    this.everSentInput = true;
    this.send({ t: 'input', seq, mx: frame.mx, my: frame.my, aim: frame.aim, buttons: frame.buttons });
  }

  /** 스냅샷의 ack로 왕복 시간을 갱신한다. 서버 ping에는 pong만 돌려줄 뿐 시간 정보가 없다. */
  noteAck(ack: number, nowMs: number): void {
    const sent = this.sentAt.get(ack);
    if (sent === undefined) return;
    for (const key of this.sentAt.keys()) {
      if (key <= ack) this.sentAt.delete(key);
    }
    const sample = nowMs - sent;
    // 튀는 값 하나에 HUD가 요동치지 않도록 지수 평균.
    this.rtt = this.rtt === 0 ? sample : this.rtt * 0.8 + sample * 0.2;
    this.handlers.onRtt(this.rtt);
  }

  close(): void {
    this.closedByUs = true;
    window.clearTimeout(this.retryTimer);
    window.clearTimeout(this.connectTimer);
    this.ws?.close();
    this.ws = null;
  }

  private setStatus(s: ConnStatus): void {
    this.status = s;
    this.handlers.onStatus(s, this.attempt);
  }

  private open(): void {
    window.clearTimeout(this.retryTimer);
    this.setStatus('connecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(socketUrl());
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;

    this.connectTimer = window.setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) ws.close();
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      window.clearTimeout(this.connectTimer);
      this.attempt = 0;
      this.backoff = BACKOFF_START_MS;
      this.everSentInput = false;
      this.setStatus('open');
      this.sendIntent();
    };

    ws.onmessage = (ev: MessageEvent<string>) => {
      const msg = decodeServer(typeof ev.data === 'string' ? ev.data : '');
      if (!msg) return;
      if (msg.t === 'welcome') {
        saveToken(msg.token);
        saveRoomCode(msg.room.code);
        this.adoptRoom(msg.room.code);
      }
      // 거부당했거나 방이 사라진 뒤에 재접속 의도를 들고 있으면 같은 실패를 무한히 반복한다.
      if (msg.t === 'denied' || msg.t === 'left') this.forgetRoom();
      // ping은 프로토콜 유지용이라 화면 로직까지 올리지 않고 여기서 즉시 되돌린다.
      if (msg.t === 'ping') {
        this.send({ t: 'pong', id: msg.id });
        return;
      }
      this.handlers.onMessage(msg);
    };

    ws.onerror = () => {
      /* close가 뒤따라 오므로 여기서는 아무것도 하지 않는다. */
    };

    ws.onclose = () => {
      window.clearTimeout(this.connectTimer);
      this.ws = null;
      if (this.closedByUs) {
        this.setStatus('closed');
        return;
      }
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    this.attempt++;
    this.setStatus('closed');
    const wait = this.backoff;
    this.backoff = Math.min(BACKOFF_MAX_MS, this.backoff * 2);
    this.retryTimer = window.setTimeout(() => this.open(), wait);
  }

  private sendIntent(): void {
    const it = this.intent;
    if (!it || this.status !== 'open') return;
    const token = loadToken();
    this.send(
      it.kind === 'create'
        ? { t: 'create', name: it.name, token, mode: it.mode, single: it.single, bots: it.bots }
        : { t: 'join', name: it.name, token, code: it.code },
    );
  }
}
