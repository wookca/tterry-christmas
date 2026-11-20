// ─────────────────────────────────────────────
// 특수 떼리앙 능력 (내 떼리앙과 다른 사람 화면이 같은 규칙을 씀)
// - 치떼링: 눈을 모으면 양손에 하나씩, 눈덩이 2개
// - 지떼링: 몸이 커서 눈덩이도 크고, 맞히는 범위가 넓음
// - 대신 둘 다 다른 떼리앙보다 느리게 걸음
// ─────────────────────────────────────────────
export const SLOW_SPEED = 0.75;   // 치떼링·지떼링 이동 속도 배율
export const BIG_BALL = 1.8;      // 지떼링 눈덩이 크기 배율
export const BIG_HIT_EXTRA = 0.55; // 지떼링 눈덩이가 맞히는 범위를 이만큼 넓힘 (m)

const ABILITIES = {
  chi: { twoBalls: true, speed: SLOW_SPEED },
  ji: { bigBall: true, speed: SLOW_SPEED },
};

// code: 'chi', 'yangnyeom-red' 처럼 버전까지 붙은 이름도 됨
export function abilityOf(code) {
  return ABILITIES[String(code || '').split('-')[0]] || {};
}
export function ballSizeOf(code) { return abilityOf(code).bigBall ? BIG_BALL : 1; }
export function hitExtraOf(size) { return size > 1 ? BIG_HIT_EXTRA : 0; }

// 몸 크기에 맞춘 맞는 범위 (원통). 예전 떼리앙(키 1.3 안팎)은 그대로 반지름 0.62, 높이 1.55
export function hitShape(dims) {
  const h = dims ? dims.h : 1.3;
  const rx = dims ? dims.rx : 0.4;
  return { r: Math.max(0.62, rx * 0.85), h: Math.max(1.55, h + 0.25) };
}
