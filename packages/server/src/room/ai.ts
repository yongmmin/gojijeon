/**
 * 컴퓨터 플레이어.
 *
 * 길찾기를 넣지 않았다. 이 게임에서는 그럴 필요가 없다 — **막히면 파면 된다.**
 * 목표 방향으로 걷다가 벽에 닿으면 그대로 곡괭이질을 하는 것만으로 봇이
 * 맵을 가로지르고, 그 과정이 사람이 하는 것과 똑같은 땅굴을 남긴다.
 * A*를 얹었다면 봇만 지형을 무시하고 다니는 이상한 게임이 됐을 것이다.
 *
 * 봇은 사람을 이기려고 만들지 않았다. 혼자서도 판이 성립하게 하고,
 * 사람이 없을 때 지형과 경제가 실제로 돌아가게 하는 것이 목적이다.
 */
import {
  Button, MAP_TILES, PLAYER, Phase, TILE,
  dist2, tileCenter, weaponDef, swingSeconds,
  type Drop, type Player, type PlayerId, type World,
} from '@gojijeon/shared';

const MAP_CENTER = (MAP_TILES * TILE) / 2;

/** 이 거리 안의 적은 인지한다. 시야가 없는 지금은 사실상 "덤빌 거리"의 정의다. */
const AGGRO_RANGE = TILE * 14;
/** 이 거리 안의 드롭은 주우러 간다. */
const LOOT_RANGE = TILE * 9;
/** 체력이 이 아래로 떨어지면 물러난다. */
const RETREAT_HP = PLAYER.maxHp * 0.3;

/**
 * 무기의 전투 가치. 레지스트리에서 파생하므로 무기를 추가해도 손댈 필요가 없다.
 * 곡괭이가 자연히 최하위로 떨어지는 것이 요점이다.
 */
const combatScore = (id: Player['weapon']): number => {
  if (!id) return 0;
  const def = weaponDef(id);
  const perHit = def.projectile ? def.projectile.damage : def.damage;
  const dps = perHit / swingSeconds(def);
  // 방패는 피해가 없지만 통로를 막는 값어치가 있다. 그렇다고 곡괭이보다 낮진 않게.
  return dps + (def.block ? 18 : 0);
};

interface Target {
  x: number;
  y: number;
  /** 도착하면 할 일. 'fight'는 사거리 안에서 휘두르고, 'dig'는 계속 파고 나아간다. */
  intent: 'fight' | 'loot' | 'dig' | 'flee';
}

export class BotBrain {
  private heading = Math.random() * Math.PI * 2;
  private lastX = 0;
  private lastY = 0;
  private stuckTicks = 0;
  /** 막혔을 때 잠깐 옆으로 새는 기간. */
  private detourUntil = 0;
  private detourAngle = 0;
  /** 줍기는 눌렀다 떼야 먹힌다. 몇 틱 눌렀는지 센다. */
  private interactTicks = 0;

  constructor(readonly id: PlayerId) {}

  think(w: World, p: Player): void {
    const input = p.input;
    input.seq += 1;

    if (!p.alive) {
      input.mx = 0; input.my = 0; input.buttons = 0;
      return;
    }

    const target = this.chooseTarget(w, p);
    let angle = Math.atan2(target.y - p.y, target.x - p.x);

    // 제자리를 맴돌면 잠시 옆으로 샌다. 암반 모서리에 끼는 걸 푸는 가장 싼 방법.
    this.trackStuck(w, p);
    if (w.tick < this.detourUntil) angle = this.detourAngle;

    this.heading = angle;
    input.mx = Math.cos(angle);
    input.my = Math.sin(angle);
    input.aim = angle;

    let buttons = 0;

    // 적이 사거리 안이면 휘두르고, 아니면 앞을 판다. 어느 쪽이든 좌클릭 하나다.
    const swing = target.intent !== 'flee';
    if (swing) buttons |= Button.PRIMARY;

    // 줍기: 눌린 상태로 한 틱만 둔다(서버가 누르는 순간만 본다).
    if (target.intent === 'loot' && dist2(p.x, p.y, target.x, target.y) < PLAYER.pickupRadius ** 2) {
      if (this.interactTicks === 0) buttons |= Button.INTERACT;
      this.interactTicks = (this.interactTicks + 1) % 8;
    } else {
      this.interactTicks = 0;
    }

    input.buttons = buttons;
  }

  private chooseTarget(w: World, p: Player): Target {
    const combat = w.phase === Phase.COMBAT;

    // 1. 위험하면 먼저 산다. 죽으면 들고 있던 무기까지 적에게 넘어간다.
    if (combat && p.hp < RETREAT_HP) {
      const home = this.homeSpawn(w, p);
      if (home) return { ...home, intent: 'flee' };
    }

    // 2. 지금 든 것보다 나은 게 발밑에 있으면 바꾼다.
    const upgrade = this.bestUpgrade(w, p);
    if (upgrade) return { x: upgrade.x, y: upgrade.y, intent: 'loot' };

    // 3. 전투 페이즈에는 가까운 적. 무기가 곡괭이뿐이면 굳이 덤비지 않는다.
    if (combat && combatScore(p.weapon) > combatScore('pickaxe')) {
      const foe = this.nearestEnemy(w, p);
      if (foe) return { x: foe.x, y: foe.y, intent: 'fight' };
    }

    // 4. 고지가 내 것이 아니면 그리로 간다. 이게 이 게임의 목적이므로
    //    봇도 같은 목적을 좇아야 판이 게임처럼 보인다.
    if (combat && w.outpost.owner !== p.team) {
      return {
        x: tileCenter(w.outpost.tx),
        y: tileCenter(w.outpost.ty),
        intent: 'fight',
      };
    }

    // 5. 그 외에는 판다. 파는 행위 자체가 광석과 무기를 주므로,
    //    할 일이 없을 때의 기본값으로 옳다.
    const goal = this.digGoal(w, p);
    return { ...goal, intent: 'dig' };
  }

  private homeSpawn(w: World, p: Player): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const s of w.spawns) {
      if (s.team !== p.team) continue;
      const d = dist2(p.x, p.y, s.x, s.y);
      if (d < bestD) { bestD = d; best = { x: s.x, y: s.y }; }
    }
    return best;
  }

  private bestUpgrade(w: World, p: Player): Drop | null {
    const mine = combatScore(p.weapon);
    let best: Drop | null = null;
    let bestScore = mine;
    for (const d of w.drops) {
      if (d.kind !== 'weapon' || w.tick < d.pickupTick) continue;
      if (dist2(p.x, p.y, d.x, d.y) > LOOT_RANGE ** 2) continue;
      const score = combatScore(d.weapon);
      if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  private nearestEnemy(w: World, p: Player): Player | null {
    let best: Player | null = null;
    let bestD = AGGRO_RANGE ** 2;
    for (const other of w.players.values()) {
      if (!other.alive || other.team === p.team || other.id === p.id) continue;
      const d = dist2(p.x, p.y, other.x, other.y);
      if (d < bestD) { bestD = d; best = other; }
    }
    return best;
  }

  private digGoal(w: World, p: Player): { x: number; y: number } {
    // 고지를 이미 들고 있다면 지키는 편이 낫다. 주변을 파며 머무른다.
    if (w.phase === Phase.COMBAT && w.outpost.owner === p.team) {
      return { x: tileCenter(w.outpost.tx), y: tileCenter(w.outpost.ty) };
    }
    const enemyCore = w.cores.find((c) => c.team !== p.team && c.hp > 0);
    if (enemyCore && w.phase === Phase.COMBAT) {
      return { x: tileCenter(enemyCore.tx), y: tileCenter(enemyCore.ty) };
    }
    return { x: MAP_CENTER, y: MAP_CENTER };
  }

  private trackStuck(w: World, p: Player): void {
    const moved = Math.hypot(p.x - this.lastX, p.y - this.lastY);
    this.lastX = p.x;
    this.lastY = p.y;

    // 파는 중이면 안 움직이는 게 정상이다. 막힌 것으로 세지 않는다.
    if (moved > 0.6 || p.miningTile >= 0) {
      this.stuckTicks = 0;
      return;
    }
    this.stuckTicks += 1;
    if (this.stuckTicks < 25 || w.tick < this.detourUntil) return;

    this.stuckTicks = 0;
    this.detourAngle = this.heading + (Math.random() < 0.5 ? -1 : 1) * (Math.PI / 2 + Math.random());
    this.detourUntil = w.tick + 20 + Math.floor(Math.random() * 25);
  }
}

const BOT_NAMES = [
  '두더지', '광부', '삽질왕', '굴착기', '지렁이', '땅꾼', '곡괭이', '뚫사',
];

export const botName = (index: number): string =>
  index < BOT_NAMES.length ? BOT_NAMES[index] : `봇${index + 1}`;

/** 방이 매 틱 호출한다. stepWorld 직전에 봇들의 입력을 채워 넣는 것이 전부다. */
export const driveBots = (w: World, brains: Map<PlayerId, BotBrain>): void => {
  for (const [id, brain] of brains) {
    const p = w.players.get(id);
    if (p) brain.think(w, p);
  }
};
