/**
 * 생성된 맵을 PNG로 찍는다.
 *
 * 맵 생성은 코드를 읽어서 맞는지 알기가 유난히 어렵다. 진입로가 정말 기지와
 * 이어졌는지, 고지 둘레가 트였는지, 대칭이 깨지지 않았는지는 **보면 1초**고
 * 코드로 따지면 한참이다. 그래서 눈으로 볼 수단을 도구로 남긴다.
 *
 *   node tools/mapshot.mjs                  # 팀전·개인전 각각 한 장
 *   node tools/mapshot.mjs 1234 team        # 특정 시드/모드만
 *
 * 결과: ./mapshot-<mode>-<seed>.png
 *
 * 의존성을 더하지 않으려고 PNG를 직접 쓴다(zlib은 노드 내장).
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { createWorld, MAP_TILES, TILE, TILES } from '@gojijeon/shared';

// ── 최소 PNG 인코더 ─────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** rgb는 width*height*3 바이트. */
const encodePng = (width, height, rgb) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // color type: truecolor
  // 나머지(압축/필터/인터레이스)는 전부 0이 표준값이다.

  // 스캔라인마다 필터 바이트 0을 앞에 붙인다.
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const src = y * width * 3;
    const dst = y * (1 + width * 3);
    raw[dst] = 0;
    rgb.copy(raw, dst + 1, src, src + width * 3);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

// ── 그리기 ──────────────────────────────────────────────────────────────────

const hex = (s) => {
  const v = parseInt(s.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

const TILE_RGB = Object.fromEntries(
  Object.entries(TILES).map(([id, d]) => [id, hex(d.color)]),
);

const SCALE = 5;

const render = (mode, seed) => {
  const w = createWorld({ seed, mode, spawnCount: mode === 'team' ? 2 : 8 });
  const size = MAP_TILES * SCALE;
  const rgb = Buffer.alloc(size * size * 3);

  const put = (px, py, [r, g, b]) => {
    if (px < 0 || py < 0 || px >= size || py >= size) return;
    const i = (py * size + px) * 3;
    rgb[i] = r; rgb[i + 1] = g; rgb[i + 2] = b;
  };

  for (let ty = 0; ty < MAP_TILES; ty++) {
    for (let tx = 0; tx < MAP_TILES; tx++) {
      const c = TILE_RGB[w.tiles[ty * MAP_TILES + tx]] ?? [255, 0, 255];
      for (let y = 0; y < SCALE; y++) {
        for (let x = 0; x < SCALE; x++) put(tx * SCALE + x, ty * SCALE + y, c);
      }
    }
  }

  const blob = (tx, ty, r, color) => {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y > r * r) continue;
        put(Math.round(tx * SCALE) + x, Math.round(ty * SCALE) + y, color);
      }
    }
  };

  // 스폰(흰색), 코어(빨강), 고지(노랑), 점령 포탑 자리(연두)
  for (const s of w.spawns) blob(s.x / TILE, s.y / TILE, 3, [255, 255, 255]);
  for (const c of w.cores) blob(c.tx, c.ty, 6, [239, 68, 68]);
  blob(w.outpost.tx, w.outpost.ty, 9, [253, 224, 71]);
  blob(w.outpost.turretTx, w.outpost.turretTy, 5, [163, 230, 53]);

  const file = `mapshot-${mode}-${seed}.png`;
  writeFileSync(file, encodePng(size, size, rgb));
  return file;
};

const [, , seedArg, modeArg] = process.argv;
const seed = Number(seedArg) || 2024;
const modes = modeArg ? [modeArg] : ['team', 'ffa'];

for (const mode of modes) {
  console.log(`${render(mode, seed)}  (흰=스폰 빨강=코어 노랑=고지 연두=점령포탑)`);
}
