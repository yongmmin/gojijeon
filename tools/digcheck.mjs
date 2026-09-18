/**
 * 무기별 굴착 성능 표.
 *
 * 이 표를 못 보고 두 번 틀렸다. 한 번은 휘두르는 주기가 짧은 단검이 곡괭이의
 * 64% 속도로 땅을 파고 있었고, 한 번은 반대로 무기로는 한 칸에 5.4초가 걸려
 * "무기를 주우면 벌받는" 게임이 됐다. 둘 다 코드를 읽어서는 안 보였고
 * 초 단위로 찍어 보니 한눈에 보였다.
 *
 *   node tools/digcheck.mjs
 */
import { MINING, TILE, TILES, Tile, WEAPONS, tileDps } from '@gojijeon/shared';

const pickDps = tileDps(WEAPONS.pickaxe);
const soft = TILES[Tile.SOFT_WALL].hp;
const vein = TILES[Tile.ORE_VEIN].hp;

const pad = (s, n) => String(s).padStart(n);

console.log('무기      굴착/초   흙벽 1칸   광맥 1칸   곡괭이 대비   닿는 거리');
console.log('─'.repeat(66));

for (const w of Object.values(WEAPONS)) {
  const isTool = w.miningPower > 0;
  const dps = isTool ? tileDps(w) : pickDps * MINING.nonPickaxeMultiplier;
  // 시뮬레이션과 같은 식으로 계산한다. 표가 실제와 다르면 표가 쓸모없다.
  const reach = Math.max(w.range, isTool ? MINING.range : MINING.minReach);
  console.log(
    w.name.padEnd(7, ' '),
    pad(dps.toFixed(1), 8),
    pad(`${(soft / dps).toFixed(1)}초`, 10),
    pad(`${(vein / dps).toFixed(1)}초`, 10),
    pad(`${((dps / pickDps) * 100).toFixed(0)}%`, 13),
    pad(`${(reach / TILE).toFixed(1)}칸`, 11),
  );
}

console.log('\n곡괭이가 가장 빠르고 멀리 닿아야 하지만, 무기로도 팔 만해야 한다.');
console.log('무기가 곡괭이의 30% 밑으로 내려가면 무기를 줍는 게 벌처럼 느껴진다.');
