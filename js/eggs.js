// ─────────────────────────────────────────────
// 이스터 에그: 내 컴퓨터(브라우저)에 횟수를 저장해 두고, 조건을 채우면 히든 떼리앙이 열림
// - 눈덩이를 10개 이상 던지면 → 히든 떼리앙 1
// - 눈덩이로 10번 맞히면 (다른 사람 떼리앙 + 포떼링 눈사람 합쳐서) → 히든 떼리앙 2
//   눈사람은 접속한 사람이 없을 때를 위한 과녁 (2026-11-20 요청)
// 열리기 전에는 선택창에서 회색 실루엣 + 자물쇠, 고를 수 없음 (2026-11-20 요청)
// 저장 위치: localStorage (같은 브라우저에서는 창을 닫았다 열어도 유지)
// ─────────────────────────────────────────────
export const HIDDEN = {
  hidden1: { stat: 'throws', need: 10, char: 'chi' },      // 던진 눈덩이 수 → 치떼링
  hidden2: { stat: 'hits', need: 10, char: 'ji' },         // 맞힌 수 (다른 떼리앙 + 눈사람) → 지떼링
};

const KEY = 'tterryEggs';
let data = { throws: 0, snowmanHits: 0, hits: null, unlocked: {}, revealed: {} };
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (saved && typeof saved === 'object') data = { ...data, ...saved, unlocked: { ...(saved.unlocked || {}) }, revealed: { ...(saved.revealed || {}) } };
} catch {}
if (data.hits == null) data.hits = data.snowmanHits || 0; // 예전 기록(눈사람만 셌던 것)은 맞힌 수에 넣어 줌
function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {} }

let onUnlock = null; // 새로 열렸을 때 부를 함수 (key, info)
export function setUnlockHandler(fn) { onUnlock = fn; }

export function addStat(stat) {
  data[stat] = (data[stat] || 0) + 1;
  for (const [key, h] of Object.entries(HIDDEN)) {
    if (h.stat === stat && !data.unlocked[key] && data[stat] >= h.need) {
      data.unlocked[key] = Date.now();
      try { onUnlock?.(key, h); } catch (e) { console.warn(e); }
    }
  }
  save();
  return data[stat];
}

export function getStat(stat) { return data[stat] || 0; }
export function isUnlocked(key) { return !!data.unlocked[key]; }
// 이 떼리앙이 아직 잠겨 있으면 true
export function isLockedChar(charId) {
  return Object.entries(HIDDEN).some(([k, h]) => h.char === charId && !data.unlocked[k]);
}
// 열렸지만 아직 선택창에서 자물쇠가 열리는 모습을 안 보여준 떼리앙 id 목록
export function pendingReveals() {
  return Object.entries(HIDDEN).filter(([k, h]) => data.unlocked[k] && !data.revealed[k]).map(([, h]) => h.char);
}
export function markRevealed(charId) {
  for (const [k, h] of Object.entries(HIDDEN)) if (h.char === charId && data.unlocked[k]) data.revealed[k] = Date.now();
  save();
}
