/**
 * 게임 씬. 입력 → 서버, 스냅샷 → 화면.
 *
 * 여기에는 게임 규칙이 없다. 보간된 서버 상태를 그리고, 누른 것을 보낼 뿐이다.
 */
import {
  BUILDABLE, Phase, TILES, Tile, type StructureId,
} from '@gojijeon/shared';
import { Camera } from '../render/camera';
import { Effects } from '../render/effects';
import { HitFeedback } from '../render/hitFeedback';
import { Minimap } from '../render/minimap';
import { SwingAnim } from '../render/swingPose';
import { TileLayer } from '../render/tileLayer';
import { drawEntities } from '../render/entityLayer';
import { drawScreenLayer } from '../render/screenLayer';
import { drawZone } from '../render/zoneLayer';
import { prewarmWeaponSprites } from '../render/weaponSprites';
import { computeGhost, drawGhost, type Ghost } from '../input/buildGhost';
import type { SampledWorld } from '../net/snapshotBuffer';
import { SelfPose } from '../net/selfPose';
import { BuildPalette } from '../ui/buildPalette';
import { LootPanel } from '../ui/lootPanel';
import { Hud } from '../ui/hud';
import { Announce } from '../ui/announce';
import { RoundEndPanel, roundReason, type RoundResult } from '../ui/roundEndPanel';
import { Overlay } from '../ui/overlay';
import { updatePauseMenu, updateStatusOverlay } from '../ui/statusOverlay';
import type { Scene, SceneContext } from './scene';

export class GameScene implements Scene {
  private readonly cam = new Camera();
  private readonly tiles = new TileLayer();
  private readonly minimap = new Minimap();
  private readonly effects = new Effects();
  /** 휘두르기 후딜은 스냅샷에 없다. 이 객체가 "방금 때렸다"를 기억한다. */
  private readonly anim = new SwingAnim();
  /** 맞은 몸의 번쩍임과 깎여 나가는 체력 잔상. */
  private readonly hits = new HitFeedback();
  private readonly hud: Hud;
  private readonly overlay = new Overlay();
  /** 전투 개시처럼 한 프레임에 터져야 하는 알림. */
  private readonly announce = new Announce();
  private readonly result = new RoundEndPanel();
  /** 구역이 좁아지기 시작한 순간을 한 번만 알리기 위한 기억. */
  private wasShrinking = false;
  /** 일시정지 메뉴는 사망·라운드 종료 안내보다 위에 떠야 한다. */
  private readonly pause = new Overlay();
  private readonly loot: LootPanel;
  private readonly build: BuildPalette;

  private sample: SampledWorld = { players: new Map(), projectiles: new Map() };
  /** 내 캐릭터만 보간을 건너뛰고 최신 위치로 수렴시킨다 — 조작이 붙는 느낌을 위해. */
  private readonly selfPose = new SelfPose();
  private aim = 0;
  private ghost: Ghost | null = null;
  private buildOpen = false;
  private lootOpen = false;
  private structure: StructureId = BUILDABLE[0];
  /** 관전 중 따라다니는 대상. null이면 자유 카메라. */
  private followId: number | null = null;
  /** 마지막 라운드·매치 결과. 이벤트가 온 그 프레임에만 근거를 볼 수 있어 거기서 굳힌다. */
  private lastResult: RoundResult | null = null;
  private paused = false;
  private nowMs = performance.now();

  constructor(private readonly ctx: SceneContext) {
    this.hud = new Hud({ onLeave: () => this.leave() });
    this.loot = new LootPanel();
    this.build = new BuildPalette((s) => {
      this.structure = s;
    });
    this.pause.root.style.zIndex = '40';
    ctx.uiRoot.append(
      this.hud.root, this.loot.root, this.build.root,
      this.announce.root, this.result.root, this.overlay.root, this.pause.root,
    );
    // 첫 교전 전에 구워 둔다. 늦어도 폴백 도형이 나오지만 한 번 깜빡이는 것도 피한다.
    prewarmWeaponSprites();
  }

  update(dtMs: number): void {
    const { world, buffer, input, conn, view, stats } = this.ctx;
    const now = performance.now();
    this.nowMs = now;

    this.sample = buffer.sample(now);
    this.cam.setViewport(view.w, view.h);

    const me = world.me;

    // 남들은 80ms 뒤를 보간해서 부드럽게, 나는 최신 위치로 빠르게 따라간다.
    // 내 손이 붙는 느낌과 남을 보는 부드러움은 서로 다른 요구다.
    if (me) {
      const live = buffer.latest?.players.find((p) => p.id === me.id);
      if (live) {
        this.sample.players.set(
          me.id,
          this.selfPose.follow({ x: live.x, y: live.y, aim: live.aim }, dtMs),
        );
      }
    }

    const pose = me ? this.sample.players.get(me.id) : undefined;
    const myX = pose ? pose.x : me ? me.x : this.cam.x;
    const myY = pose ? pose.y : me ? me.y : this.cam.y;

    this.moveCamera(dtMs, me !== null && me.alive && !me.spectating, myX, myY);

    // 조준은 언제나 화면의 마우스 위치를 향한다 — 죽어 있어도 각도 자체는 유효하다.
    const wx = this.cam.screenToWorldX(input.mouseX);
    const wy = this.cam.screenToWorldY(input.mouseY);
    this.aim = Math.atan2(wy - myY, wx - myX);

    this.handleCommands(myX, myY);

    this.ghost =
      this.buildOpen && me ? computeGhost(world, me, myX, myY, this.aim, this.structure) : null;

    // 메뉴가 떠 있는 동안 조작을 흘려보내면 버튼을 누르다 공격이 나간다.
    const frozen = !me || !me.alive || me.spectating || this.paused;
    const move = frozen ? { mx: 0, my: 0 } : input.moveVector();
    conn.pumpInput(
      {
        mx: move.mx,
        my: move.my,
        aim: this.aim,
        buttons: frozen ? 0 : input.buttonMask({ suppressPrimary: this.buildOpen }),
      },
      now,
    );

    const events = world.drainEvents();
    for (const ev of events) {
      if (ev.t === 'roundEnd') {
        this.lastResult = { kind: 'round', team: ev.winner, reason: roundReason(world, ev.winner) };
      } else if (ev.t === 'matchEnd') {
        // 매치 종료는 직전 라운드의 근거를 그대로 쓴다 — 매치는 라운드 승수로 갈린다.
        this.lastResult = { kind: 'match', team: ev.winner, reason: this.lastResult?.reason ?? null };
      }
      // 준비 시간이 10초뿐이라 상단 글자가 바뀌는 것만으로는 아무도 못 알아챈다.
      else if (ev.t === 'phase' && ev.phase === Phase.COMBAT) {
        this.announce.show('전투 시작', '고지로!', now);
      }
    }

    // 구역이 줄기 시작하는 순간은 이벤트로 오지 않는다. 플래그가 서는 프레임을 잡는다.
    const shrinking = world.snapshot?.zone?.shrinking ?? false;
    if (shrinking && !this.wasShrinking) {
      this.announce.show('구역이 좁아진다', '경계 안으로', now);
    }
    this.wasShrinking = shrinking;
    this.effects.ingest(events, world);
    this.hits.ingest(events, this.nowMs);
    this.effects.update(dtMs);

    this.tiles.sync(world);
    this.minimap.sync(world);
    // 봉쇄벽이 걷히는 것은 이벤트로 오지 않는다. 사라진 자리에 파편을 한 번 터뜨려
    // "지금 열렸다"를 알림과 같은 프레임에 보여준다.
    for (const [tile, was] of world.tileWas) {
      if (was === Tile.BARRIER) this.effects.shatter(tile, TILES[Tile.BARRIER].color);
    }
    world.dirty.clear();
    world.tileWas.clear();

    this.hud.update({ world, rttMs: stats.rttMs, fps: stats.fps });
    this.loot.update(this.lootOpen);
    this.build.update(me, this.structure, this.buildOpen);
    updateStatusOverlay(world, this.overlay, this.hud, this.result, this.lastResult);
    this.announce.update(now);
    updatePauseMenu(this.pause, this.paused, {
      onResume: () => { this.paused = false; },
      onLeave: () => this.leave(),
    });
  }

  render(ctx: CanvasRenderingContext2D): void {
    const { world, view } = this.ctx;
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, view.w, view.h);

    this.cam.apply(ctx);
    // 피격 흔들림은 카메라가 아니라 그리기 단계에서만 준다 — 카메라를 흔들면
    // 화면↔월드 변환이 어긋나 조준이 마우스를 따라오지 않는다.
    const shake = this.effects.shake;
    if (shake.x !== 0 || shake.y !== 0) ctx.translate(shake.x, shake.y);
    this.tiles.draw(ctx, this.cam, this.nowMs);
    drawEntities(ctx, world, this.sample, this.cam, { nowMs: this.nowMs, anim: this.anim, hits: this.hits });
    if (this.ghost) drawGhost(ctx, this.ghost, this.structure);
    // 구역은 개체 위에 덮는다 — 밖에 서 있는 사람도 같이 어두워져야 위험해 보인다.
    const zone = world.snapshot?.zone;
    if (zone) drawZone(ctx, zone, this.cam, this.nowMs);
    this.effects.render(ctx);
    ctx.restore();

    drawScreenLayer(ctx, {
      world, cam: this.cam, minimap: this.minimap, effects: this.effects,
      viewW: view.w, viewH: view.h, nowMs: this.nowMs,
    });
  }

  destroy(): void {
    for (const node of [
      this.hud.root, this.loot.root, this.build.root,
      this.announce.root, this.result.root, this.overlay.root, this.pause.root,
    ]) {
      node.remove();
    }
  }

  // ── 내부 ───────────────────────────────────────────────────────────────────

  private moveCamera(dtMs: number, followMe: boolean, myX: number, myY: number): void {
    if (followMe) {
      this.cam.free = false;
      this.followId = null;
      this.cam.follow(myX, myY, dtMs);
      return;
    }
    const target = this.followId === null
      ? null
      : this.sample.players.get(this.followId) ?? null;
    if (target) {
      this.cam.free = false;
      this.cam.follow(target.x, target.y, dtMs);
      return;
    }
    // 관전 자유 카메라. 입력은 이동 벡터를 그대로 쓴다.
    this.cam.free = true;
    const { mx, my } = this.ctx.input.moveVector();
    if (mx !== 0 || my !== 0) this.cam.pan(mx, my, dtMs);
  }

  private handleCommands(myX: number, myY: number): void {
    for (const cmd of this.ctx.input.drainCommands()) {
      switch (cmd.c) {
        case 'toggleBuild':
          this.buildOpen = !this.buildOpen;
          if (this.buildOpen) this.lootOpen = false;
          break;
        case 'toggleLoot':
          this.lootOpen = !this.lootOpen;
          if (this.lootOpen) this.buildOpen = false;
          break;
        case 'digit': {
          if (this.buildOpen) {
            const s = this.build.pick(cmd.n);
            if (s) this.structure = s;
          }
          break;
        }
        case 'click':
          if (cmd.button === 'left' && this.buildOpen) this.sendBuild(myX, myY);
          break;
        case 'cycleFollow':
          this.cycleFollow();
          break;
        case 'escape':
          // 열린 패널이 있으면 그것부터 닫는다. 아무것도 없을 때만 일시정지 메뉴.
          if (this.buildOpen || this.lootOpen) {
            this.buildOpen = false;
            this.lootOpen = false;
          } else {
            this.paused = !this.paused;
          }
          break;
      }
    }
  }

  /** 살아 있는 플레이어를 한 명씩 돌다가 마지막에 자유 카메라로 돌아온다. */
  private cycleFollow(): void {
    const alive = (this.ctx.world.snapshot?.players ?? []).filter((p) => p.alive).map((p) => p.id);
    if (alive.length === 0) {
      this.followId = null;
      return;
    }
    if (this.followId === null) {
      this.followId = alive[0];
      return;
    }
    const i = alive.indexOf(this.followId);
    this.followId = i < 0 || i === alive.length - 1 ? null : alive[i + 1];
  }

  private sendBuild(myX: number, myY: number): void {
    const me = this.ctx.world.me;
    if (!me) return;
    const g = computeGhost(this.ctx.world, me, myX, myY, this.aim, this.structure);
    // 불가능한 자리는 아예 보내지 않는다. 서버 검증은 그대로 살아 있다.
    if (!g.ok) return;
    this.ctx.conn.send({ t: 'action', action: { type: 'build', tx: g.tx, ty: g.ty, structure: this.structure } });
  }

  private leave(): void {
    this.paused = false;
    this.ctx.conn.leaveRoom();
  }
}
