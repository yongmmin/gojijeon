/**
 * 인게임 HUD. 캔버스가 아니라 DOM으로 그린다(텍스트 선명도 때문).
 *
 * 미니맵만 캔버스 쪽(render/minimap.ts)에 있다 — 우상단 자리를 비워 두고
 * 접속자 목록을 그 아래로 내린다.
 */
import {
  OUTPOST, PLAYER, Phase, TICK_HZ, TICK_MS, TILES, Tile, WEAPONS,
} from '@gojijeon/shared';
import type { ClientWorld } from '../net/clientWorld';
import { VIS } from '../render/visualConfig';
import { teamColor } from '../render/colors';
import { teamLabel } from '../render/teamLabel';
import { weaponIcon } from './weaponIcon';
import { OutpostBanner } from './outpostBanner';
import { StandingsTable } from './standingsTable';
import { el, formatClock, setShown, setText } from './dom';

const PHASE_LABEL: Record<Phase, string> = {
  [Phase.LOBBY]: '대기',
  [Phase.PREP]: '준비',
  [Phase.COMBAT]: '전투',
  [Phase.ROUND_END]: '라운드 종료',
  [Phase.MATCH_END]: '매치 종료',
};

/**
 * 페이즈 이름만으로는 "지금 뭘 못 하는지"를 알 수 없다.
 * 준비 중에도 사람은 때릴 수 있다는 것과, 막힌 것은 중앙뿐이라는 것을 같이 적는다.
 */
const PHASE_NOTE: Partial<Record<Phase, string>> = {
  [Phase.PREP]: '중앙 봉쇄 — 고지는 아직 점령할 수 없다 · 사람은 지금도 때릴 수 있다',
  [Phase.COMBAT]: '봉쇄 해제 — 고지를 지키면 내 것이 된다',
};

// 점령 시간은 밸런스 값이다 — 숫자를 여기 적어 두면 balance.ts를 고칠 때마다 거짓말이 된다.
const HINTS =
  'WASD 이동 · 좌클릭 공격/채굴 · E 줍기 · Q 버리기 · B 건설 · C 무기는 어디서 나오나 · ' +
  `맵 한가운데 고지를 우리 팀만 ${Math.round(OUTPOST.captureTicks / TICK_HZ)}초 지키면 점령(포탑이 선다) · ` +
  'F 관전 카메라 · ESC 메뉴';

export interface HudHandlers {
  onLeave: () => void;
}

export interface HudModel {
  world: ClientWorld;
  rttMs: number;
  fps: number;
}

export class Hud {
  readonly root = el('div');

  private readonly resNode = el('div', { class: 'mono' });
  private readonly netNode = el('div', { class: 'muted mono' });
  private readonly phaseNode = el('div');
  private readonly clockNode = el('div', { class: 'mono' });
  private readonly scoreNode = el('div', { class: 'muted' });
  private readonly phaseNote = el('div', { class: 'muted' });
  private readonly weaponNode = el('div');
  private readonly weaponIcon = weaponIcon(22);
  private readonly outpost = new OutpostBanner();
  private readonly hpFill = el('i');
  private readonly hpText = el('div', { class: 'muted mono' });
  private readonly standings = StandingsTable.titled('compact', '순위');
  private readonly noticeNode = el('div', { class: 'panel corner bc' });

  constructor(handlers: HudHandlers) {
    this.root.append(
      this.buildTopLeft(),
      this.buildTopCenter(),
      this.outpost.root,
      this.buildBottomLeft(),
      this.buildStandings(),
      this.buildHints(),
      this.buildNotice(),
      this.buildLeave(handlers.onLeave),
    );
  }

  setVisible(v: boolean): void {
    setShown(this.root, v);
  }

  update({ world, rttMs, fps }: HudModel): void {
    const snap = world.snapshot;
    const me = world.me;

    setText(this.resNode, `광석 ${me ? me.ore : 0}   조각 ${me ? me.shard : 0}`);
    setText(this.netNode, `${Math.round(rttMs)}ms · ${Math.round(fps)}fps`);

    if (snap) {
      setText(this.phaseNode, PHASE_LABEL[snap.phase] ?? snap.phase);
      const note = PHASE_NOTE[snap.phase] ?? '';
      setText(this.phaseNote, note);
      setShown(this.phaseNote, note !== '');
      const remain = ((snap.phaseEndTick - snap.tick) * TICK_MS) / 1000;
      setText(this.clockNode, formatClock(remain));
      setText(this.scoreNode, `라운드 ${snap.round}   ${formatScore(world, snap.score)}`);
      this.standings.table.update(world);
    }
    this.outpost.update(world, snap?.outpost);

    const def = me && me.weapon ? WEAPONS[me.weapon] : null;
    setText(this.weaponNode, def ? def.name : '맨손');
    this.weaponIcon.set(def ? def.id : null, def ? def.color : null);
    const hp = me ? Math.max(0, me.hp) : 0;
    this.hpFill.style.width = `${(hp / PLAYER.maxHp) * 100}%`;
    setText(this.hpText, `${Math.round(hp)} / ${PLAYER.maxHp}`);
  }

  /** 관전처럼 계속 붙어 있어야 하는 안내. 화면을 덮는 오버레이 대신 쓴다. */
  setNotice(text: string | null): void {
    setShown(this.noticeNode, text !== null);
    if (text !== null) setText(this.noticeNode, text);
  }

  /** ESC를 모르는 사람도 방을 떠날 수 있어야 한다. 구석에 작게 둔다. */
  private buildLeave(onLeave: () => void): HTMLElement {
    const btn = el('button', { class: 'clickable', text: '나가기' });
    btn.style.position = 'absolute';
    btn.style.right = '12px';
    btn.style.bottom = '12px';
    btn.style.padding = '5px 10px';
    btn.style.fontSize = '12px';
    btn.addEventListener('click', onLeave);
    return btn;
  }

  private buildNotice(): HTMLElement {
    this.noticeNode.style.bottom = '48px';
    this.noticeNode.style.whiteSpace = 'nowrap';
    setShown(this.noticeNode, false);
    return this.noticeNode;
  }

  private buildHints(): HTMLElement {
    const node = el('div', { class: 'panel corner bc muted', text: HINTS });
    node.style.whiteSpace = 'nowrap';
    return node;
  }

  private buildTopLeft(): HTMLElement {
    const ore = el('span', { class: 'sw' });
    ore.style.background = TILES[Tile.ORE_VEIN].color;
    const shard = el('span', { class: 'sw' });
    shard.style.background = TILES[Tile.SHARD_NODE].color;
    return el('div', { class: 'panel corner tl' }, [
      el('div', { class: 'chips' }, [ore, shard, this.resNode]),
      this.netNode,
    ]);
  }

  private buildTopCenter(): HTMLElement {
    this.clockNode.style.fontSize = '22px';
    this.phaseNode.style.letterSpacing = '2px';
    this.phaseNote.style.maxWidth = '420px';
    return el('div', { class: 'panel corner tc' }, [
      this.phaseNode, this.clockNode, this.phaseNote, this.scoreNode,
    ]);
  }

  private buildBottomLeft(): HTMLElement {
    const bar = el('div', { class: 'bar' }, [this.hpFill]);
    bar.style.width = '180px';
    return el('div', { class: 'panel corner bl' }, [
      el('div', { class: 'chips' }, [this.weaponIcon.node, this.weaponNode]),
      bar,
      this.hpText,
    ]);
  }

  private buildStandings(): HTMLElement {
    const box = el('div', { class: 'panel corner tr' }, [this.standings.root]);
    // 미니맵은 캔버스가 우상단에 그리므로 순위표를 그 아래로 민다.
    box.style.top = `${VIS.minimap.size + VIS.minimap.margin * 2}px`;
    return box;
  }
}

// 점수판도 고지 배너와 같은 이름 규칙을 쓴다 — 한 화면에서 같은 팀을 다르게 부르면 안 된다.
const formatScore = (world: ClientWorld, score: Record<string, number>): string => {
  const entries = Object.entries(score);
  if (entries.length === 0) return '';
  return entries.map(([team, v]) => `${teamLabel(world, Number(team))} ${v}`).join(' · ');
};
