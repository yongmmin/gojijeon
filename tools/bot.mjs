/**
 * 가짜 사람.
 *
 * 게임 안의 컴퓨터 플레이어는 서버에 들어 있다(packages/server/src/room/ai.ts).
 * 이 스크립트는 그것과 다르다 — **멀티플레이 방에 소켓으로 붙는 가짜 손님**이라,
 * 여러 명이 동시에 접속했을 때의 네트워크와 로비 흐름을 혼자서 확인할 수 있다.
 *
 *   node tools/bot.mjs ABCD            # 코드 ABCD 방에 1명, localhost:8080
 *   node tools/bot.mjs ABCD 3 8081     # 3명, 포트 8081
 *   node tools/bot.mjs ABCD 3 8081 idle  # 가만히 서 있기만(전투 연습용)
 *
 * 움직임은 단순하다. 중앙 쪽으로 걸으면서 앞을 판다. 그거면 지형이 실제로
 * 뚫리고 자원이 돌기 때문에, 화면과 네트워크를 확인하기에는 충분하다.
 */
import { WebSocket } from 'ws';

const [, , codeArg, countArg, portArg, modeArg] = process.argv;
const CODE = (codeArg ?? '').toUpperCase();
const COUNT = Math.max(1, Number(countArg) || 1);
const PORT = Number(portArg) || 8080;
const IDLE = modeArg === 'idle';

if (!/^[A-Z0-9]{4}$/.test(CODE)) {
  console.error('방 코드 4자를 첫 인자로 주세요.  예)  node tools/bot.mjs ABCD 3 8081');
  process.exit(1);
}

const TILE = 32;
const MAP_PX = 128 * TILE;
const CENTER = MAP_PX / 2;
const TICK_MS = 50;

const BUTTON_PRIMARY = 1;

const NAMES = ['두더지', '광부', '삽질왕', '굴착기', '지렁이', '땅꾼', '곡괭이', '뚫사'];

class Bot {
  constructor(index) {
    this.name = NAMES[index % NAMES.length] + (index >= NAMES.length ? index : '');
    this.seq = 0;
    this.you = null;
    this.me = null;
    this.phase = 'lobby';
    /** 파던 방향을 조금씩 틀어 준다. 한 방향만 보면 암반에 박혀 멈춘다. */
    this.drift = Math.random() * Math.PI * 2;
  }

  start() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);

    this.ws.on('open', () => {
      this.send({ t: 'join', name: this.name, token: null, code: CODE });
    });

    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString('utf8'));
      if (m.t === 'welcome') {
        this.you = m.you;
        console.log(`[${this.name}] 입장 (id=${m.you})`);
        this.send({ t: 'ready', ready: true });
        this.loop = setInterval(() => this.act(), TICK_MS);
      } else if (m.t === 'snapshot') {
        this.me = m.s.players.find((p) => p.id === this.you);
        if (m.s.phase !== this.phase) {
          this.phase = m.s.phase;
          console.log(`[${this.name}] ${this.phase}`);
        }
      } else if (m.t === 'ping') {
        this.send({ t: 'pong', id: m.id });
      } else if (m.t === 'denied') {
        console.error(`[${this.name}] 거절됨: ${m.reason}`);
      } else if (m.t === 'left') {
        console.log(`[${this.name}] 퇴장${m.reason ? `: ${m.reason}` : ''}`);
      }
    });

    this.ws.on('close', () => {
      clearInterval(this.loop);
      console.log(`[${this.name}] 연결 종료`);
    });
    this.ws.on('error', (e) => console.error(`[${this.name}] ${e.message}`));
  }

  act() {
    if (!this.me || !this.me.alive) return;
    if (IDLE) {
      this.send({ t: 'input', seq: ++this.seq, mx: 0, my: 0, aim: 0, buttons: 0 });
      return;
    }

    // 중앙 방향을 기본으로 하되, 천천히 흔들어 암반을 우회한다.
    this.drift += (Math.random() - 0.5) * 0.25;
    const toCenter = Math.atan2(CENTER - this.me.y, CENTER - this.me.x);
    const aim = toCenter + Math.sin(this.drift) * 0.6;

    this.send({
      t: 'input',
      seq: ++this.seq,
      mx: Math.cos(aim),
      my: Math.sin(aim),
      aim,
      buttons: BUTTON_PRIMARY,
    });
  }

  send(m) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
}

const bots = [];
for (let i = 0; i < COUNT; i++) {
  const b = new Bot(i);
  bots.push(b);
  // 동시에 붙이면 팀 배정이 한쪽으로 몰릴 수 있어 살짝 어긋나게 넣는다.
  setTimeout(() => b.start(), i * 120);
}

console.log(`가짜 손님 ${COUNT}명을 127.0.0.1:${PORT} 의 ${CODE} 방에 붙입니다. 종료는 Ctrl+C.`);

process.on('SIGINT', () => {
  for (const b of bots) b.ws?.close();
  process.exit(0);
});
