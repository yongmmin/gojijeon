/**
 * 무기 그림(SVG 마크업).
 *
 * 외부 에셋을 쓰지 않는 이유: 라이선스가 걸리고, 색을 레지스트리에서 끌어올 수
 * 없으며, 확대하면 깨진다. 벡터로 직접 그리면 세 가지가 전부 해결된다.
 *
 * 규약: 모든 무기는 **오른쪽(+x)을 향한 자세**로 그린다. 회전은 그리는 쪽이
 * 맡으므로 여기에는 각도 개념이 없다. 색은 함수 인자로만 들어온다 —
 * 무기 고유색을 이 파일에 적어 두면 레지스트리와 화면이 갈라진다.
 */
import { MATERIAL as M } from './visualConfig';
import type { WeaponId } from '@gojijeon/shared';

export interface WeaponArt {
  /** viewBox 크기. 스프라이트 종횡비가 여기서 나온다. */
  readonly vw: number;
  readonly vh: number;
  /** 월드 기준 가로 길이(px). 세로는 종횡비를 따라간다. */
  readonly len: number;
  /** 손이 쥐는 지점(viewBox 정규화 좌표). 회전 중심이자 배치 기준점. */
  readonly grip: readonly [number, number];
  /** 대기 자세. */
  readonly body: (color: string) => string;
  /** 당겨진 자세(활 시위). 없으면 body를 그대로 쓴다. */
  readonly pulled?: (color: string) => string;
}

/** 실루엣용 검은 외곽선. 흙벽 위든 바닥 위든 무기 윤곽이 남게 한다. */
const inked = (shapes: string): string =>
  `<g stroke="${M.outline}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">${shapes}</g>`;

/** 날붙이 전용. 둥근 접합으로 칠하면 뾰족한 끝이 뭉개져 무기로 안 보인다. */
const bladed = (shapes: string): string =>
  `<g stroke="${M.outline}" stroke-width="3" stroke-linejoin="miter" stroke-miterlimit="6">${shapes}</g>`;

/** 외곽선을 먹지 않는 덧칠(광택·시위). 위에 얹어 입체감만 준다. */
const gloss = (shapes: string): string =>
  `<g fill="none" stroke-linecap="round">${shapes}</g>`;

// ── 곡괭이 ────────────────────────────────────────────────────────────────────
// 나무 자루 + 양쪽으로 굽은 금속 머리. 위에서 보면 머리가 자루를 가로지른다.
const pickaxe = (c: string): string =>
  inked(`<rect x="4" y="21" width="68" height="10" rx="5" fill="${M.wood}"/>` +
    `<rect x="8" y="19" width="17" height="14" rx="5" fill="${M.leather}"/>`) +
  // 벌어진 V가 보여야 도끼가 아니라 곡괭이로 읽힌다 — 두 갈래 사이를 비워 둔다.
  bladed(
    `<path d="M58 15 Q80 11 99 3 Q92 19 79 26 Z" fill="${c}"/>` +
    `<path d="M58 37 Q80 41 99 49 Q92 33 79 26 Z" fill="${c}"/>`,
  ) +
  inked(`<rect x="56" y="15" width="16" height="22" rx="4" fill="${M.metalDark}"/>`) +
  gloss(`<path d="M64 14 L92 6" stroke="${M.gloss}" stroke-width="2.4"/>`);

// ── 단검 ──────────────────────────────────────────────────────────────────────
// 짧은 날 + 작은 코등이 + 손잡이. 길이로 창과 즉시 구별된다.
const dagger = (c: string): string =>
  inked(
    `<circle cx="11" cy="22" r="7" fill="${M.metalDark}"/>` +
    `<rect x="11" y="16" width="24" height="12" rx="5" fill="${M.leather}"/>` +
    `<rect x="34" y="5" width="9" height="34" rx="4" fill="${M.metal}"/>`,
  ) +
  bladed(`<path d="M43 12 L74 17 L97 22 L74 27 L43 32 Z" fill="${c}"/>`) +
  gloss(`<path d="M48 22 L88 22" stroke="${M.gloss}" stroke-width="2.4"/>`);

// ── 표창 ──────────────────────────────────────────────────────────────────────
// 네 갈래 별. 손가락에 끼우는 물건이라 작고, 날붙이 셋 중 유일하게 **자루가 없다** —
// 단검·창과 실루엣이 겹치지 않는 지점이 거기다.
const shuriken = (c: string): string =>
  bladed(
    `<path d="M32 2 L40 24 L62 32 L40 40 L32 62 L24 40 L2 32 L24 24 Z" fill="${c}"/>`,
  ) +
  inked(`<circle cx="32" cy="32" r="6" fill="${M.outline}"/>`) +
  gloss(
    `<path d="M32 8 L36 26" stroke="${M.gloss}" stroke-width="2.4"/>` +
    `<path d="M8 32 L26 36" stroke="${M.gloss}" stroke-width="2.4"/>`,
  );

// ── 창 ────────────────────────────────────────────────────────────────────────
// 긴 자루 + 나뭇잎 모양 날. 화면에서 가장 긴 무기라 사거리가 그림만으로 읽힌다.
const spear = (c: string): string =>
  inked(
    `<rect x="4" y="16" width="86" height="9" rx="4" fill="${M.wood}"/>` +
    `<rect x="14" y="14" width="10" height="13" rx="3" fill="${M.leather}"/>` +
    `<rect x="40" y="14" width="10" height="13" rx="3" fill="${M.leather}"/>` +
    `<rect x="80" y="13" width="11" height="15" rx="3" fill="${M.metalDark}"/>`,
  ) +
  bladed(`<path d="M88 20 C96 9 104 6 123 20 C104 34 96 31 88 20 Z" fill="${c}"/>`) +
  gloss(`<path d="M94 20 L116 20" stroke="${M.gloss}" stroke-width="2.2"/>`);

// ── 활 ────────────────────────────────────────────────────────────────────────
// 굽은 활대 + 시위. 당긴 자세는 별도 스프라이트라 발사 순간이 눈에 보인다.
const bowLimb = (c: string, d: string): string =>
  `<path d="${d}" fill="none" stroke="${M.outline}" stroke-width="13" stroke-linecap="round"/>` +
  `<path d="${d}" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round"/>`;

const bow = (c: string): string =>
  bowLimb(c, 'M30 8 C60 26 60 78 30 96') +
  inked(`<rect x="44" y="40" width="15" height="24" rx="6" fill="${M.leather}"/>`) +
  gloss(`<path d="M30 8 L30 96" stroke="${M.string}" stroke-width="2.4"/>`);

const bowPulled = (c: string): string =>
  bowLimb(c, 'M36 12 C64 28 64 76 36 92') +
  inked(
    `<rect x="44" y="40" width="15" height="24" rx="6" fill="${M.leather}"/>` +
    `<path d="M62 52 L76 47 L76 57 Z" fill="${M.metal}"/>`,
  ) +
  gloss(
    `<path d="M36 12 L10 52 L36 92" stroke="${M.string}" stroke-width="2.6"/>` +
    `<path d="M12 52 L74 52" stroke="${M.wood}" stroke-width="4"/>` +
    `<path d="M62 52 L74 52" stroke="${M.metal}" stroke-width="4"/>`,
  );

// ── 방패 ──────────────────────────────────────────────────────────────────────
// 위에서 본 방패판. 캐릭터 앞을 가로막는 굽은 판이라 "막는 물건"으로 읽힌다.
const shield = (c: string): string =>
  inked(
    `<rect x="14" y="40" width="24" height="16" rx="5" fill="${M.leather}"/>` +
    `<path d="M30 4 C54 22 54 74 30 92 L16 87 C40 70 40 26 16 9 Z" fill="${c}"/>` +
    `<ellipse cx="42" cy="48" rx="8" ry="11" fill="${M.metal}"/>`,
  ) +
  gloss(`<path d="M31 14 C49 30 49 66 31 82" stroke="${M.gloss}" stroke-width="2.6"/>`);

// ── 망치 ──────────────────────────────────────────────────────────────────────
// 자루 + 두툼한 사각 머리. 곡괭이와 달리 머리가 네모라 멀리서도 안 헷갈린다.
const hammer = (c: string): string =>
  inked(
    `<rect x="5" y="23" width="70" height="10" rx="5" fill="${M.wood}"/>` +
    `<rect x="9" y="21" width="17" height="14" rx="5" fill="${M.leather}"/>` +
    `<rect x="64" y="8" width="31" height="40" rx="6" fill="${c}"/>` +
    `<rect x="69" y="12" width="6" height="32" rx="2" fill="${M.metalDark}"/>` +
    `<rect x="85" y="12" width="6" height="32" rx="2" fill="${M.metalDark}"/>`,
  ) +
  gloss(`<path d="M78 14 L78 42" stroke="${M.gloss}" stroke-width="2.6"/>`);

// ── 폭탄 ──────────────────────────────────────────────────────────────────────
// 둥근 몸통 + 심지. 심지 끝의 불꽃이 "지금 타고 있다"를 말해 준다.
const bomb = (c: string): string =>
  inked(
    `<circle cx="30" cy="39" r="21" fill="${c}"/>` +
    `<rect x="23" y="12" width="15" height="12" rx="4" fill="${M.metalDark}"/>`,
  ) +
  gloss(
    `<path d="M38 17 C52 9 56 20 64 11" stroke="${M.woodDark}" stroke-width="5"/>` +
    `<circle cx="65" cy="10" r="7" fill="${M.spark}" stroke="none"/>` +
    `<circle cx="65" cy="10" r="3" fill="#ffffff" stroke="none"/>` +
    `<circle cx="22" cy="32" r="6" fill="${M.gloss}" stroke="none"/>`,
  );

/**
 * 무기 id → 그림. **없는 id는 없는 채로 둔다** — 그리는 쪽이 kind 폴백으로
 * 넘어가므로, shared에 무기를 새로 추가해도 클라를 고치지 않고 일단 나온다.
 */
export const WEAPON_ART: Partial<Record<WeaponId, WeaponArt>> = {
  pickaxe: { vw: 102, vh: 52, len: 31, grip: [0.14, 0.5], body: pickaxe },
  dagger: { vw: 100, vh: 44, len: 25, grip: [0.13, 0.5], body: dagger },
  // 손가락에 끼운 물건이라 손 바로 앞에 붙는다(그립이 거의 한가운데).
  shuriken: { vw: 64, vh: 64, len: 18, grip: [0.42, 0.5], body: shuriken },
  spear: { vw: 126, vh: 40, len: 52, grip: [0.13, 0.5], body: spear },
  bow: { vw: 84, vh: 104, len: 31, grip: [0.55, 0.5], body: bow, pulled: bowPulled },
  shield: { vw: 60, vh: 96, len: 22, grip: [0.42, 0.5], body: shield },
  hammer: { vw: 100, vh: 56, len: 31, grip: [0.14, 0.5], body: hammer },
  bomb: { vw: 74, vh: 64, len: 19, grip: [0.41, 0.6], body: bomb },
};

/** viewBox를 씌운 완성 SVG 문서. 스프라이트 래스터화와 DOM 아이콘이 같이 쓴다. */
export const weaponSvg = (art: WeaponArt, color: string, pulled: boolean): string => {
  const inner = pulled && art.pulled ? art.pulled(color) : art.body(color);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${art.vw} ${art.vh}" ` +
    `width="${art.vw}" height="${art.vh}">${inner}</svg>`
  );
};
