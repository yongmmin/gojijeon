/**
 * SVG → 캔버스 스프라이트 캐시.
 *
 * SVG는 **최초 1회만** 래스터화한다. 매 프레임 SVG를 파싱하면 8인 난전에서
 * 프레임이 무너진다. 준비되기 전에는 null을 돌려주므로 부르는 쪽이 폴백 도형으로
 * 버틸 수 있다 — 로딩 때문에 화면이 비는 일은 없다.
 *
 * 무기든 구급품이든 그림이면 전부 여기를 지난다. 무엇을 그리는지는 모른다.
 */
import { WEAPON_VIS } from './visualConfig';

export interface SpriteSource {
  /** viewBox 크기. 종횡비가 여기서 나온다. */
  readonly vw: number;
  readonly vh: number;
  /** 월드 기준 가로 길이(px). 세로는 종횡비를 따라간다. */
  readonly len: number;
  /** 회전·배치의 기준점(viewBox 정규화 좌표). */
  readonly grip: readonly [number, number];
  /** viewBox까지 씌운 완성 SVG 문서. */
  readonly svg: string;
}

export interface Sprite {
  readonly image: CanvasImageSource;
  /** 월드 px 크기. */
  readonly w: number;
  readonly h: number;
  /** 좌상단 기준 기준점 위치(월드 px). */
  readonly gx: number;
  readonly gy: number;
}

const ready = new Map<string, Sprite>();
const busy = new Set<string>();

export const svgDataUrl = (svg: string): string =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** 이미 있거나 만드는 중이면 아무것도 하지 않는다. 같은 그림을 두 번 굽지 않게. */
export const rasterize = (key: string, src: SpriteSource): void => {
  if (ready.has(key) || busy.has(key)) return;
  busy.add(key);

  const w = src.len;
  const h = (src.len * src.vh) / src.vw;
  const img = new Image();
  img.onload = (): void => {
    busy.delete(key);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * WEAPON_VIS.spriteScale));
    canvas.height = Math.max(1, Math.round(h * WEAPON_VIS.spriteScale));
    const c = canvas.getContext('2d');
    if (!c) return;
    c.drawImage(img, 0, 0, canvas.width, canvas.height);
    ready.set(key, { image: canvas, w, h, gx: src.grip[0] * w, gy: src.grip[1] * h });
  };
  // 실패해도 폴백 도형이 있으므로 조용히 포기한다. 게임은 계속 돌아야 한다.
  img.onerror = (): void => {
    busy.delete(key);
  };
  img.src = svgDataUrl(src.svg);
};

/** 준비된 스프라이트. 없으면 null을 주고 뒤에서 만들기 시작한다. */
export const sprite = (key: string, src: SpriteSource): Sprite | null => {
  const hit = ready.get(key);
  if (hit) return hit;
  rasterize(key, src);
  return null;
};

export interface DrawOpts {
  scale?: number;
  alpha?: number;
}

/** 기준점을 (x, y)에 두고 `angle`만큼 돌려 그린다. 아직 없으면 false. */
export const drawSprite = (
  ctx: CanvasRenderingContext2D,
  key: string,
  src: SpriteSource,
  x: number,
  y: number,
  angle: number,
  opts: DrawOpts = {},
): boolean => {
  const sp = sprite(key, src);
  if (!sp) return false;
  const k = opts.scale ?? 1;
  ctx.save();
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.drawImage(sp.image, -sp.gx * k, -sp.gy * k, sp.w * k, sp.h * k);
  ctx.restore();
  return true;
};
