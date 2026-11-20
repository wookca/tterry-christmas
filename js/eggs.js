// ─────────────────────────────────────────────
// 이스터 에그: 내 컴퓨터(브라우저)에 횟수를 저장해 두고, 조건을 채우면 히든 떼리앙이 열림
// - 눈덩이를 10개 이상 던지면 → 히든 떼리앙 1
// - 포떼링 눈사람을 10번 맞히면 → 히든 떼리앙 2
// 어느 떼리앙이 열리는지는 아직 안 정함: HIDDEN 의 char 에 떼리앙 id를 넣으면 됨
// 저장 위치: localStorage (같은 브라우저에서는 창을 닫았다 열어도 유지)
// ─────────────────────────────────────────────
export const HIDDEN = {
  hidden1: { stat: 'throws', need: 10, char: null },      // 던진 눈덩이 수
  hidden2: { stat: 'snowmanHits', need: 10, char: null }, // 눈사람을 맞힌 수
};

const KEY = 'tterryEggs';
let data = { throws: 0, snowmanHits: 0, unlocked: {} };
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (saved && typeof saved === 'object') data = { ...data, ...saved, unlocked: { ...(saved.unlocked || {}) } };
} catch {}
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
// 열린 히든 떼리앙의 id 목록 (char 가 정해진 것만)
export function unlockedChars() {
  return Object.entries(HIDDEN).filter(([k, h]) => h.char && data.unlocked[k]).map(([, h]) => h.char);
}
