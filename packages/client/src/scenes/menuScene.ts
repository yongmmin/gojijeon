/**
 * 메뉴 씬. 이름 → 싱글/멀티 → 방까지의 단계 흐름을 소켓에 연결한다.
 *
 * 화면 구성은 전부 ui/menu/* 가 맡는다. 여기 있는 것은 "어떤 버튼이 어떤 메시지가 되는가"뿐이다.
 * 배경은 캔버스에 아주 느리게 움직이는 지층 무늬만 깐다.
 */
import { saveName } from '../net/session';
import { MenuView } from '../ui/menu/menuView';
import type { MenuState } from '../ui/menu/menuState';
import type { MenuHandlers, MenuModel } from '../ui/menu/menuTypes';
import type { Scene, SceneContext } from './scene';

export class MenuScene implements Scene {
  private readonly view: MenuView;
  private t = 0;

  constructor(private readonly ctx: SceneContext, private readonly state: MenuState) {
    this.view = new MenuView(this.handlers());
    this.ctx.uiRoot.append(this.view.root);
  }

  update(dtMs: number): void {
    this.t += dtMs;
    this.syncToRoom();
    this.view.update(this.model());
  }

  render(ctx: CanvasRenderingContext2D): void {
    const { w, h } = this.ctx.view;
    ctx.fillStyle = '#0b0d12';
    ctx.fillRect(0, 0, w, h);

    // 흙 지층이 아주 느리게 흐르는 배경. 정적인 검은 화면보다 "땅속"이 읽힌다.
    const drift = (this.t / 90) % 64;
    ctx.strokeStyle = 'rgba(90,70,50,0.16)';
    ctx.lineWidth = 18;
    ctx.beginPath();
    for (let y = -64 + drift; y < h + 64; y += 64) {
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(w * 0.3, y + 14, w * 0.7, y - 14, w, y);
    }
    ctx.stroke();
  }

  destroy(): void {
    this.view.root.remove();
  }

  // ── 내부 ───────────────────────────────────────────────────────────────────

  /** 서버가 방을 확정해 주면 단계를 거기에 맞춘다. 싱글은 곧 게임 씬이 가져간다. */
  private syncToRoom(): void {
    const room = this.ctx.world.room;
    if (!room) return;
    if (room.single) {
      this.state.pending = true;
      return;
    }
    this.state.pending = false;
    if (this.state.step !== 'room') this.state.goto('room');
  }

  private model(): MenuModel {
    const { world } = this.ctx;
    return {
      step: this.state.step,
      name: this.state.name,
      mode: world.room ? world.room.mode : this.state.mode,
      bots: world.room ? world.room.bots : this.state.bots,
      code: this.state.code,
      notice: this.state.notice,
      pending: this.state.pending,
      room: world.room,
      players: world.lobby ? world.lobby.players : [],
      canStart: world.lobby ? world.lobby.canStart : false,
      youId: world.youId,
      isHost: world.isHost,
    };
  }

  private handlers(): MenuHandlers {
    const { conn } = this.ctx;
    const st = this.state;
    const inRoom = (): boolean => st.step === 'room';

    return {
      onNameChange: (name) => {
        st.name = name;
      },
      onStep: (step) => {
        // 링크(?code=)로 들어왔다면 멀티를 고르는 순간 코드 입력 단계로 바로 보낸다.
        if (step === 'multi' && st.linkShortcut && st.codeReady) {
          st.linkShortcut = false;
          st.goto('join');
          return;
        }
        if (st.nameReady) saveName(st.name.trim());
        st.goto(step);
      },
      onMode: (mode) => {
        if (inRoom()) conn.send({ t: 'setMode', mode });
        else st.mode = mode;
      },
      onBots: (count) => {
        if (inRoom()) conn.send({ t: 'setBots', count });
        else st.bots = count;
      },
      onCodeChange: (code) => st.setCode(code),
      onCreate: (single) => {
        if (!st.nameReady) return;
        const name = st.name.trim();
        saveName(name);
        st.begin();
        conn.createRoom({ name, mode: st.mode, single, bots: single ? st.bots : 0 });
      },
      onJoin: () => {
        if (!st.nameReady || !st.codeReady) return;
        const name = st.name.trim();
        saveName(name);
        st.begin();
        conn.joinRoom({ name, code: st.code });
      },
      onReady: (ready) => conn.send({ t: 'ready', ready }),
      onStart: () => conn.send({ t: 'startMatch' }),
      onLeave: () => conn.leaveRoom(),
    };
  }
}
