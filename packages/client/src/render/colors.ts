/** 색 계산 헬퍼. 원본 색은 전부 shared 레지스트리에서 오고, 여기서는 변형만 한다. */
import { TEAM_COLORS } from './visualConfig';

export const teamColor = (team: number): string =>
  TEAM_COLORS[((team % TEAM_COLORS.length) + TEAM_COLORS.length) % TEAM_COLORS.length];

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const withAlpha = (hex: string, a: number): string => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

/** f<1이면 어둡게, f>1이면 밝게. */
export const shade = (hex: string, f: number): string => {
  const [r, g, b] = hexToRgb(hex);
  const c = (v: number): number => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
};

/**
 * 밝기와 투명도를 한 번에.
 *
 * `withAlpha(shade(...))`는 동작하지 않는다 — withAlpha는 #rrggbb만 읽는데
 * shade는 rgb(...)를 돌려주므로 NaN이 되고, 캔버스는 잘못된 색을 조용히 무시해
 * 직전 색을 그대로 쓴다(그래서 빛나야 할 칸이 검게 나왔다).
 */
export const shadeAlpha = (hex: string, f: number, a: number): string => {
  const [r, g, b] = hexToRgb(hex);
  const c = (v: number): number => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgba(${c(r)},${c(g)},${c(b)},${a})`;
};
