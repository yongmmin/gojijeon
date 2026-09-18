/**
 * 순수 시각 상수만 사는 곳.
 *
 * 게임 밸런스 숫자는 단 하나도 여기 오지 않는다 — 그건 전부 @gojijeon/shared의
 * balance.ts 소관이다. 여기 있는 값은 바꿔도 게임 규칙이 달라지지 않는 것들뿐이다.
 */
export const VIS = {
  /** 카메라가 목표를 따라가는 비율(초당 감쇠). 1에 가까울수록 즉시 붙는다. */
  cameraLerpPerSec: 12,
  /** 관전 자유 이동 속도(px/s). */
  freeCamSpeed: 900,

  /** 플레이어 이름표 폰트. 내 이름만 한 단계 굵고 크게 쓴다. */
  nameFont: '600 11px system-ui, sans-serif',
  nameFontStrong: '700 12px system-ui, sans-serif',
  hudFont: '11px system-ui, sans-serif',
  damageFont: '700 14px system-ui, sans-serif',

  /** 이름표 알약. */
  nameTag: { padX: 6, padY: 2, height: 16, radius: 6, gap: 14, botAlpha: 0.38 },

  /** 내 캐릭터 표식(링 + 머리 위 마커). */
  self: {
    ringGap: 4,
    ringWidth: 2.5,
    markerSize: 9,
    /** 캐릭터 반지름 바깥으로 이만큼 위에 마커 꼭짓점을 둔다. */
    markerGap: 40,
    bobAmp: 3,
    bobPeriodMs: 1100,
  },

  /** HP 바 크기. */
  hpBarWidth: 30,
  hpBarHeight: 4,

  /** 파티클 수명(ms). */
  particleLifeMs: 420,
  ringLifeMs: 320,
  dustLifeMs: 520,
  damageTextLifeMs: 780,
  flashLifeMs: 180,
  /** 이벤트 하나가 만드는 파편 수. */
  burstCount: 8,
  burstSpeed: 130,

  /** 미니맵(화면 우상단). */
  minimap: { size: 168, margin: 12, alpha: 0.9 },

  /** 굴착 진행 오버레이의 최대 어둡기. */
  mineOverlayAlpha: 0.55,

  /** 스냅샷 버퍼가 들고 있는 최대 과거(ms). */
  snapshotHistoryMs: 1000,

  /** 내가 맞았을 때만 흔든다. 길거나 크면 조준이 불가능해지므로 한 뼘만. */
  shakeMaxPx: 5,
  shakeLifeMs: 220,
} as const;

/**
 * 무기 그림의 보조 재질색.
 *
 * 무기를 알아보게 하는 **고유색은 WEAPONS[id].color**에서 오고, 여기 있는 건
 * 나무 자루·금속·가죽처럼 어느 무기에나 똑같이 쓰이는 재질뿐이다. 무기 색을
 * 여기에 복제하면 레지스트리와 화면이 따로 놀게 된다.
 */
export const MATERIAL = {
  /** 어떤 타일 위에서도 실루엣이 읽히게 하는 외곽선. */
  outline: '#0b0d12',
  wood: '#8a5a33',
  woodDark: '#5a3a20',
  leather: '#3f3f46',
  metal: '#cbd5e1',
  metalDark: '#64748b',
  string: '#e5e7eb',
  spark: '#fde68a',
  gloss: 'rgba(255,255,255,0.38)',
} as const;

export const WEAPON_VIS = {
  /** 스프라이트 래스터화 배율. 화면 확대가 없는 2D라 2배면 계단이 보이지 않는다. */
  spriteScale: 2,
  /** 캐릭터 중심에서 손까지. 몸통 밖으로 나와야 무기가 몸에 묻히지 않는다. */
  handGap: 3,
  /** 바닥 드롭: 뭔지 알아보되 주인공보다 커 보이면 안 된다. */
  dropScale: 0.78,
  dropBobPx: 2.5,
  dropBobMs: 1700,
  dropSpinMs: 5200,
} as const;

/**
 * 휘두르기 모션의 모양만 정한다 — 타이밍은 전부 서버 값(windup/recoverTicks)에서 온다.
 * 여기 숫자를 바꿔도 판정 시점은 1틱도 움직이지 않는다.
 */
export const SWING = {
  /** 후딜 중 앞으로 터져 나가는 구간의 비율. 짧을수록 타격이 날카롭다. */
  strikeRatio: 0.32,
  /** 근접 휘두름이 훑는 각도(rad)의 하한·상한. halfArc가 이 사이로 사상된다. */
  arcMin: 0.6,
  arcMax: 1.9,
  /** 되돌아오는 각이 전체에서 차지하는 비율(나머지는 앞으로 나간다). */
  backRatio: 0.62,
  /** 최대 전진 거리는 사거리의 이 비율. */
  thrustRatio: 0.34,
  /** 선딜에 뒤로 당기는 양(전진 거리 기준). */
  windupPull: 0.42,
  /** 활을 쏜 직후 뒤로 밀리는 거리(px). */
  bowRecoil: 7,
  /** 던지는 팔이 앞으로 나가는 거리(px). */
  throwPush: 13,
  /** 방패를 밀어내는 거리(px). */
  shieldPush: 9,
  /** 궤적 잔상이 사라지는 기울기. 클수록 빨리 사라진다. */
  trailFade: 1.15,
} as const;

/** 구급품. 회복량·확률은 balance.ts 소관이고 여기 있는 건 생김새뿐이다. */
export const HEALTH_VIS = {
  case: '#f1f5f9',
  cross: '#ef4444',
  /** 바닥에 놓였을 때 가로 길이(px). 무기보다 작지만 후광으로 눈에 띈다. */
  sizePx: 17,
  pulseMs: 1100,
  bobPx: 2,
  /** 화면 밖 구급품을 가리키는 범위(px)와 화면 가장자리에서 띄우는 여백. */
  compassRange: 520,
  compassInset: 34,
  /** 회복 텍스트·링 색. */
  heal: '#4ade80',
} as const;

/** 피격 피드백. 한 대가 체력의 8%뿐이라, 숫자 말고 화면이 때렸다고 말해야 한다. */
export const HIT_VIS = {
  /** 맞은 몸이 번쩍이는 시간(ms). 길면 난전에서 계속 하얗다. */
  bodyFlashMs: 110,
  /** 줄어든 체력을 잔상으로 남겼다가 따라오게 하는 시간(ms). */
  hpGhostMs: 480,
  /** 잔상이 붙어 있는 동안 체력바를 굵게. */
  hpBarBoost: 3,
  /** 깎여 나간 구간의 색. */
  hpGhost: '#fca5a5',
  /** 데미지 숫자 크기와 튀어 오르는 속도(px/s). */
  damageFontBig: '800 19px system-ui, sans-serif',
  damagePopSpeed: 60,
  /** 내가 맞았을 때 화면 가장자리 붉은 비네트의 최대 진하기. */
  vignetteAlpha: 0.5,
  /** 이 비율 아래면 상시 은은한 맥동 비네트. */
  lowHpRatio: 0.3,
  lowHpAlpha: 0.3,
  lowHpPulseMs: 1400,
} as const;

/** 고지(맵 중앙 상징물). 색은 팀색과 타일 레지스트리에서 오고 여기엔 크기만 둔다. */
export const OUTPOST_VIS = {
  /** 상징물(오벨리스크) 크기. 밟고 서는 칸이므로 타일보다 조금 넘겨도 된다. */
  monumentW: 15,
  monumentH: 38,
  /** 점령 게이지 링 반지름과 두께. */
  gaugeRadius: 30,
  gaugeWidth: 5,
  /** 경합 중 점멸 주기(ms). */
  contestBlinkMs: 420,
  /** 중립일 때의 색. 팀색과 절대 헷갈리면 안 되는 회색. */
  neutral: '#94a3b8',
  /** 경합 경고색. */
  contest: '#f87171',
  /** 점령 반경 원의 진하기. */
  fieldAlpha: 0.07,
  /** 미니맵 위 고지 표식 한 변(px). */
  minimapMark: 7,
} as const;

/** 팀 색. 팀 번호를 인덱스로 돌려 쓴다 — 팀 수가 늘어도 코드를 고칠 필요가 없다. */
export const TEAM_COLORS: readonly string[] = [
  '#60a5fa', '#f87171', '#a3e635', '#fbbf24',
  '#c084fc', '#4fd1c5', '#fb923c', '#f472b6',
];
