// ─────────────────────────────────────────────
// 떼리앙 말투: 채팅의 80% 정도를 "떼"로 바꿈
//   안녕하세요 → 안녕떼떼떼 / 무슨 말이 이래 → 무슨 떼떼 이떼 / 아 완전 웃겨 → 떼 떼떼 웃떼
// 서버(server/worker.js)가 이 파일로 바꿔서 모두에게 같은 글을 보냄 → 누구 화면에서나 똑같이 보임
// (서버가 없는 혼자 하기에서만 내 화면에서 바꿈)
// ─────────────────────────────────────────────
export const CHAT_MAX = 40; // 한 번에 보낼 수 있는 글자 수

// 보내기 전에 정리: 줄바꿈·제어 문자 없애고, 공백은 하나로, 최대 글자 수
export function cleanChat(v) {
  return String(v || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
}

const HANGUL = /[가-힣]/;
const LATIN = /[A-Za-z]/;

// 글을 단어 조각으로 나눔: 한글 덩어리 / 영어 덩어리 / 그 밖(공백, 숫자, 문장부호, ㅋㅋ 같은 자음, 이모지)은 그대로
function split(text) {
  const parts = [];
  for (const ch of Array.from(text)) {
    const kind = HANGUL.test(ch) ? 'ko' : LATIN.test(ch) ? 'en' : 'keep';
    const last = parts[parts.length - 1];
    if (last && last.kind === kind && kind !== 'keep') last.s += ch;
    else parts.push({ kind, s: ch });
  }
  return parts;
}

// rand: 0~1 난수 함수 (기본 Math.random)
export function tteify(text, rand = Math.random) {
  const parts = split(cleanChat(text));
  const words = [];
  for (const p of parts) {
    if (p.kind === 'ko') { p.n = Array.from(p.s).length; p.keep = 0; words.push(p); }
    else if (p.kind === 'en') { p.n = Math.max(1, Math.min(3, Math.round(p.s.length / 3))); p.keep = 0; words.push(p); }
  }
  const total = words.reduce((a, w) => a + w.n, 0);
  // 남길 글자 수: 전체의 25~40% (한 글자짜리 말은 그냥 "떼")
  let budget = total <= 1 ? 0 : Math.max(1, Math.round(total * (0.25 + rand() * 0.15)));
  // 단어를 섞어서 차례로 앞부분 몇 글자씩 남김 (짧은 단어는 통째로, 긴 단어는 절반까지)
  const order = words.map((w, i) => [rand(), i]).sort((a, b) => a[0] - b[0]).map((x) => words[x[1]]);
  for (const w of order) {
    if (budget <= 0) break;
    if (w.kind === 'en') { if (w.n <= budget) { w.keep = w.n; budget -= w.n; } continue; } // 영어는 통째로 남기거나 통째로 바꿈
    const cap = w.n <= 2 ? w.n : Math.floor(w.n / 2);
    const take = Math.min(budget, rand() < 0.65 ? cap : 1 + Math.floor(rand() * cap)); // 대개 앞 절반(짧은 단어는 통째로)을 남겨서 알아들을 수 있게
    w.keep = take; budget -= take;
  }
  return parts.map((p) => {
    if (p.kind === 'keep') return p.s;
    if (p.kind === 'en') return p.keep ? p.s : '떼'.repeat(p.n);
    return Array.from(p.s).slice(0, p.keep).join('') + '떼'.repeat(p.n - p.keep);
  }).join('');
}
