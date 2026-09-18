/**
 * 부트스트랩. 루프 하나, 씬 하나, 소켓 하나.
 *
 * 여기서 하는 일은 넷뿐이다: 캔버스 크기 관리, 서버 메시지를 ClientWorld에 흘려넣기,
 * 방에 들고 나는 사건을 메뉴 상태에 반영하기, 페이즈에 맞는 씬 갈아끼우기.
 */
import { Phase } from '@gojijeon/shared';
import { Connection, type ConnStatus } from './net/connection';
import { ClientWorld } from './net/clientWorld';
import { SnapshotBuffer } from './net/snapshotBuffer';
import { InputController } from './input/inputController';
import { GameScene } from './scenes/gameScene';
import { MenuScene } from './scenes/menuScene';
import type { Scene, SceneContext } from './scenes/scene';
import { bootMenu } from './ui/menu/menuState';
import { Overlay } from './ui/overlay';

const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui');
if (!(canvas instanceof HTMLCanvasElement) || !uiRoot) throw new Error('index.html 구조가 예상과 다릅니다');
const ctx2d = canvas.getContext('2d');
if (!ctx2d) throw new Error('이 브라우저에서는 2D 캔버스를 쓸 수 없습니다');

const world = new ClientWorld();
const buffer = new SnapshotBuffer();
const input = new InputController();
const view = { w: window.innerWidth, h: window.innerHeight };
const stats = { rttMs: 0, fps: 60 };

/** 메뉴 상태는 씬보다 오래 산다 — 게임에 들어갔다 나와도 이름과 마지막 사유가 남아야 한다. */
const { state: menuState, autoJoinCode } = bootMenu();
/** 새로고침 복귀 시도 중인가. 이 시도가 실패하면 사유 없이 조용히 메뉴로 돌아간다. */
let silentRejoin = autoJoinCode !== null;

/** 연결 상태 오버레이는 씬보다 위에 있어야 하므로 main이 직접 들고, z-index로 맨 앞에 둔다. */
const connOverlay = new Overlay();
connOverlay.root.style.zIndex = '50';
uiRoot.append(connOverlay.root);

/** 방에서 튕겨 나온 뒤 남은 상태를 그대로 두면 메뉴 뒤로 죽은 맵이 계속 비친다. */
const dropRoom = (): void => {
  world.reset();
  buffer.clear();
};

const conn = new Connection({
  onMessage: (m) => {
    const now = performance.now();
    switch (m.t) {
      case 'welcome':
        silentRejoin = false;
        world.applyWelcome(m);
        buffer.clear();
        buffer.push(m.snapshot, now);
        break;
      case 'reset':
        world.applyReset(m);
        break;
      case 'snapshot':
        world.applySnapshot(m.s);
        buffer.push(m.s, now);
        conn.noteAck(m.s.ack, now);
        break;
      case 'lobby':
        world.applyLobby(m);
        break;
      case 'denied':
        dropRoom();
        // 사용자가 직접 누른 시도만 사유를 보여 준다. 자동 복귀 실패는 소음일 뿐이다.
        if (silentRejoin) menuState.toStart(null);
        else menuState.fail(m.reason);
        silentRejoin = false;
        break;
      case 'left':
        dropRoom();
        silentRejoin = false;
        menuState.toStart(m.reason);
        break;
      case 'ping':
        // Connection이 이미 pong으로 답했다.
        break;
    }
  },
  onStatus: (status, attempt) => renderConnOverlay(status, attempt),
  onRtt: (rtt) => {
    stats.rttMs = rtt;
  },
});

const sceneCtx: SceneContext = { canvas, uiRoot, conn, world, buffer, input, view, stats };

let scene: Scene | null = null;
let sceneKind: 'menu' | 'game' | null = null;

/** welcome(=지형)을 받기 전에는 게임 씬으로 넘어가지 않는다. 빈 맵을 그리는 것보다 메뉴가 낫다. */
const wantedScene = (): 'menu' | 'game' =>
  world.youId >= 0 && world.snapshot && world.snapshot.phase !== Phase.LOBBY ? 'game' : 'menu';

const syncScene = (): void => {
  const want = wantedScene();
  if (want === sceneKind) return;
  scene?.destroy();
  scene = want === 'game' ? new GameScene(sceneCtx) : new MenuScene(sceneCtx, menuState);
  sceneKind = want;
};

function renderConnOverlay(status: ConnStatus, attempt: number): void {
  if (status === 'open') {
    connOverlay.hide();
    return;
  }
  if (status === 'connecting' && attempt === 0) {
    connOverlay.show('서버에 연결 중…');
    return;
  }
  connOverlay.show('서버에 연결할 수 없습니다 — 재시도 중', `${attempt}번째 시도`);
}

const resize = (): void => {
  // 고해상도 화면에서 4K 픽셀을 다 칠할 이유는 없다. 2배까지만 따라간다.
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  view.w = window.innerWidth;
  view.h = window.innerHeight;
  canvas.width = Math.round(view.w * dpr);
  canvas.height = Math.round(view.h * dpr);
  canvas.style.width = `${view.w}px`;
  canvas.style.height = `${view.h}px`;
};

window.addEventListener('resize', resize);
resize();
input.attach(canvas);
conn.connect();
if (autoJoinCode) conn.joinRoom({ name: menuState.name.trim(), code: autoJoinCode });

let last = performance.now();
const frame = (now: number): void => {
  // 탭이 백그라운드에 있다가 돌아오면 dt가 몇 초씩 튄다. 물리가 없어도 카메라가 순간이동한다.
  const dt = Math.min(100, now - last);
  last = now;
  stats.fps = stats.fps * 0.9 + (dt > 0 ? 1000 / dt : 60) * 0.1;

  syncScene();

  const dpr = canvas.width / Math.max(1, view.w);
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.clearRect(0, 0, view.w, view.h);

  scene?.update(dt);
  scene?.render(ctx2d);

  requestAnimationFrame(frame);
};

requestAnimationFrame(frame);
